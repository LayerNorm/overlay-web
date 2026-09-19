import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  managedAgentHostCommand,
  type OverlayManagedAcpAdapterId,
  type SandboxInstance,
  type SandboxRuntime,
} from '@overlay/sandbox-runtime'
import { BoxSandboxRuntime } from '@overlay/sandbox-runtime/box'
import { DaytonaSandboxRuntime } from '@overlay/sandbox-runtime/daytona'
import { VercelSandboxRuntime } from '@overlay/sandbox-runtime/vercel'
import { isManagedHarnessId, type ManagedHarnessId } from '@overlay/workspace-contracts'
import type { AuditService } from '@/server/admin'
import { managedHarnessEntry } from '@/shared/agents/harness-catalog'
import type { ConnectedAgentControlPlaneService } from './ConnectedAgentControlPlaneService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import type { ConnectedAgentPolicyLimits } from './ConnectedAgentPolicy'
import { managedHarnessDescriptor } from './harnesses/registry'
import { resolveManagedHarnessSandboxProvider } from './harnesses/sandbox-providers'

export const MANAGED_HARNESS_IDLE_TIMEOUT_MS = 15 * 60_000
export const MANAGED_HARNESS_HARD_TIMEOUT_MS = 24 * 60 * 60_000
const MANAGED_ROOT = '/workspace'
// diskGiB stays within Daytona's per-sandbox 10 GiB cap; Vercel only reads vcpus.
const MANAGED_RESOURCES = { vcpus: 2, memoryGiB: 4, diskGiB: 10 } as const
export const MANAGED_HARNESS_DENIED_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']

export type ManagedAgentProvisionRequest =
  | {
      actorUserId: string
      workspaceId: string
      serverUrl: string
      mode?: 'agent-host'
      adapterId: OverlayManagedAcpAdapterId
    }
  | {
      actorUserId: string
      workspaceId: string
      serverUrl: string
      mode: 'harness'
      harnessId: ManagedHarnessId
      provider?: string
    }

export class ManagedAgentSandboxService {
  constructor(private readonly dependencies: {
    audit: AuditService
    controlPlane: ConnectedAgentControlPlaneService
    repository: ConnectedAgentRepository
    runtime?: SandboxRuntime
    sleep?: (ms: number) => Promise<void>
    policyLimits?: (input: { userId: string; workspaceId: string }) => Promise<ConnectedAgentPolicyLimits>
  }) {}

  async provision(args: ManagedAgentProvisionRequest) {
    if (args.mode === 'harness') return await this.provisionHarness(args)
    return await this.provisionAgentHost(args)
  }

  /**
   * Managed HarnessAgent provisioning. No enrollment, no host image, no
   * control-plane polling — the server owns the sandbox and writes the
   * `overlay_cloud` environment (server-approved, fixed filesystem root) and
   * lease directly. The harness itself bootstraps into the sandbox on the
   * first turn (`docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`).
   */
  private async provisionHarness(args: {
    actorUserId: string
    workspaceId: string
    serverUrl: string
    harnessId: ManagedHarnessId
    provider?: string
  }) {
    const entry = managedHarnessEntry(args.harnessId)
    if (!entry || !isManagedHarnessId(args.harnessId)) {
      throw managedSandboxError('Unsupported managed harness', 400, 'harness_invalid')
    }
    let provider: string
    try {
      provider = resolveManagedHarnessSandboxProvider(args.provider)
    } catch (error) {
      throw managedSandboxError(
        error instanceof Error ? error.message : 'Managed sandbox provider is unavailable',
        503,
        'managed_sandbox_provider_invalid',
      )
    }
    const runtime = this.dependencies.runtime ?? managedSandboxRuntimeFromEnv(provider)
    const descriptor = managedHarnessDescriptor(args.harnessId)
    const limits = await this.dependencies.policyLimits?.({ userId: args.actorUserId, workspaceId: args.workspaceId })
    const idleTimeoutMs = Math.min(MANAGED_HARNESS_IDLE_TIMEOUT_MS, limits?.maxIdleDurationMs ?? MANAGED_HARNESS_IDLE_TIMEOUT_MS)
    const hardTimeoutMs = Math.min(MANAGED_HARNESS_HARD_TIMEOUT_MS, limits?.maxRunTimeMs ?? MANAGED_HARNESS_HARD_TIMEOUT_MS)
    const name = `overlay-harness-${randomUUID().slice(0, 8).toLowerCase()}`
    let sandbox: SandboxInstance | null = null
    try {
      sandbox = await runtime.create({
        name,
        persistent: true,
        ports: entry.requiresSandboxPort && descriptor.bridgePort ? [descriptor.bridgePort] : [],
        networkPolicy: {
          mode: 'allowlist',
          domains: managedHarnessAllowedDomains(args.serverUrl, descriptor.modelApiHosts),
          deniedCidrs: [...MANAGED_HARNESS_DENIED_CIDRS],
        },
        idleTimeoutMs,
        hardTimeoutMs,
        resources: { ...MANAGED_RESOURCES },
        metadata: {
          overlay: 'true', kind: 'managed-harness', harness: args.harnessId, workspace: args.workspaceId,
        },
      })
      const now = Date.now()
      const environment = await this.dependencies.repository.createEnvironment({
        id: randomUUID(),
        workspaceId: args.workspaceId,
        kind: 'overlay_cloud',
        name,
        status: 'online',
        capabilities: {
          runtime: 'ai-sdk-harness',
          adapters: [{ id: args.harnessId, protocol: 'harness' }],
          // Reconnect-time recreation rebuilds the egress allowlist from this
          // host plus the descriptor's model API hosts.
          serverHost: new URL(args.serverUrl).hostname,
        },
        filesystemGrant: { mode: 'selected_roots', roots: [MANAGED_ROOT] },
        approvedAt: now,
        approvedByUserId: args.actorUserId,
        now,
      })
      const lease = await this.dependencies.repository.createSandboxLease({
        id: randomUUID(),
        workspaceId: args.workspaceId,
        environmentId: environment.id,
        provider: runtime.provider,
        providerReference: sandbox.reference,
        status: 'running',
        reservedUntil: now + hardTimeoutMs,
        runtimeStartedAt: now,
        // meteredUsage/meterVersion seed the billing meter's cursor — the
        // first tick bills the full provider-reported lifetime of this lease.
        usage: { resources: { ...MANAGED_RESOURCES }, idleTimeoutMs, lastActiveAt: now, meteredUsage: {}, meterVersion: 0 },
        cleanupAttempts: 0,
        now,
      })
      await this.dependencies.audit.record({
        action: 'agent_environment.managed_provisioned',
        actorType: 'user',
        actorUserId: args.actorUserId,
        outcome: 'success',
        resourceType: 'agent_environment',
        resourceId: environment.id,
        metadata: {
          workspaceId: args.workspaceId,
          leaseId: lease.id,
          provider: runtime.provider,
          providerReference: sandbox.reference,
          mode: 'harness',
          harnessId: args.harnessId,
        },
      })
      const { publicKey: _publicKey, ...publicEnvironment } = environment
      return {
        environment: publicEnvironment,
        lease: { id: lease.id, status: lease.status },
        setup: {
          label: 'Overlay Cloud' as const,
          approvedRoot: MANAGED_ROOT,
          mode: 'harness' as const,
          harnessId: args.harnessId,
          provider: runtime.provider,
        },
      }
    } catch (error) {
      if (sandbox) await sandbox.delete().catch((_error) => undefined)
      throw error
    }
  }

  private async provisionAgentHost(args: {
    actorUserId: string
    workspaceId: string
    serverUrl: string
    adapterId: OverlayManagedAcpAdapterId
  }) {
    const runtime = this.dependencies.runtime ?? managedSandboxRuntimeFromEnv()
    const onBox = runtime.provider === 'box'
    const limits = await this.dependencies.policyLimits?.({ userId: args.actorUserId, workspaceId: args.workspaceId })
    const idleTimeoutMs = Math.min(MANAGED_HARNESS_IDLE_TIMEOUT_MS, limits?.maxIdleDurationMs ?? MANAGED_HARNESS_IDLE_TIMEOUT_MS)
    const hardTimeoutMs = Math.min(MANAGED_HARNESS_HARD_TIMEOUT_MS, limits?.maxRunTimeMs ?? MANAGED_HARNESS_HARD_TIMEOUT_MS)
    const image = process.env.OVERLAY_AGENT_HOST_IMAGE?.trim()
    // Boxes have no custom-image concept — the host installs via npx at boot.
    if (!image && !onBox) throw managedSandboxError('OVERLAY_AGENT_HOST_IMAGE is not configured', 503, 'managed_sandbox_image_missing')
    const enrollment = await this.dependencies.controlPlane.createEnrollmentSession({
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
    })
    const suffix = enrollment.enrollmentSessionId.slice(0, 8).toLowerCase()
    const name = `overlay-cloud-${suffix}`
    let sandbox: SandboxInstance | null = null
    try {
      sandbox = await runtime.create({
        name,
        ...(image ? { image } : {}),
        persistent: true,
        environment: { OVERLAY_MANAGED_ENVIRONMENT: '1' },
        // Box has no egress-allowlist primitive. allow_all is acceptable here
        // because the box holds nothing worth exfiltrating: the enrollment
        // code is single-use and redeemed immediately, model credentials stay
        // server-side behind the gateway, and customer BYOK is never placed in
        // the environment. Egress enforcement returns with the Overlay proxy.
        networkPolicy: onBox
          ? { mode: 'allow_all' }
          : {
            mode: 'allowlist',
            domains: managedAllowedDomains(args.serverUrl),
            deniedCidrs: [...MANAGED_HARNESS_DENIED_CIDRS],
          },
        idleTimeoutMs,
        hardTimeoutMs,
        resources: { ...MANAGED_RESOURCES },
        metadata: { overlay: 'true', kind: 'agent-host', workspace: args.workspaceId },
      })
      await sandbox.runCommand(agentHostBootstrapCommand(runtime.provider, {
        enrollmentCode: enrollment.code,
        serverUrl: args.serverUrl,
        name,
        adapters: [args.adapterId],
      }))

      const environment = await this.waitForEnvironment(args.workspaceId, name)
      const now = Date.now()
      const lease = await this.dependencies.repository.createSandboxLease({
        id: randomUUID(),
        workspaceId: args.workspaceId,
        environmentId: environment.id,
        provider: runtime.provider,
        providerReference: sandbox.reference,
        status: 'running',
        reservedUntil: now + hardTimeoutMs,
        runtimeStartedAt: now,
        usage: { resources: { ...MANAGED_RESOURCES }, idleTimeoutMs, lastActiveAt: now, meteredUsage: {}, meterVersion: 0 },
        cleanupAttempts: 0,
        now,
      })
      await this.dependencies.audit.record({
        action: 'agent_environment.managed_provisioned',
        actorType: 'user',
        actorUserId: args.actorUserId,
        outcome: 'success',
        resourceType: 'agent_environment',
        resourceId: environment.id,
        metadata: {
          workspaceId: args.workspaceId,
          leaseId: lease.id,
          provider: runtime.provider,
          providerReference: sandbox.reference,
          adapterId: args.adapterId,
        },
      })
      const { publicKey: _publicKey, ...publicEnvironment } = environment
      return {
        environment: publicEnvironment,
        lease: { id: lease.id, status: lease.status },
        setup: { label: 'Overlay Cloud', approvedRoot: MANAGED_ROOT, adapterId: args.adapterId },
      }
    } catch (error) {
      if (sandbox) await sandbox.delete().catch((_error) => undefined)
      throw error
    }
  }

  private async waitForEnvironment(workspaceId: string, name: string) {
    const sleep = this.dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const environments = await this.dependencies.repository.listEnvironments({ workspaceId })
      const environment = environments.find((candidate) => candidate.name === name && candidate.kind === 'overlay_cloud')
      if (environment) return environment
      await sleep(500)
    }
    throw managedSandboxError('Overlay Cloud host did not redeem its enrollment in time', 504, 'managed_sandbox_enrollment_timeout')
  }
}

export class ManagedAgentSandboxError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'ManagedAgentSandboxError'
  }
}

export function managedSandboxRuntimeFromEnv(providerOverride?: string): SandboxRuntime {
  const provider = providerOverride?.trim().toLowerCase()
    || process.env.OVERLAY_MANAGED_SANDBOX_PROVIDER?.trim().toLowerCase()
    || defaultManagedSandboxProvider()
  if (provider === 'box') {
    const apiKey = process.env.BOX_API_KEY?.trim()
    if (!apiKey) {
      throw managedSandboxError('Box is not configured: set BOX_API_KEY', 503, 'managed_sandbox_provider_invalid')
    }
    return new BoxSandboxRuntime({ apiKey })
  }
  if (provider === 'vercel') {
    // On Vercel the platform issues a fresh OIDC token per request (via the
    // x-vercel-oidc-token request context, not process.env) — prefer it over
    // static VERCEL_TOKEN/TEAM_ID/PROJECT_ID so a stale or revoked long-lived
    // token cannot take sandbox provisioning down.
    const runningOnVercel = Boolean(process.env.VERCEL?.trim())
    const token = process.env.VERCEL_TOKEN?.trim()
    const teamId = process.env.VERCEL_TEAM_ID?.trim()
    const projectId = process.env.VERCEL_PROJECT_ID?.trim()
    return new VercelSandboxRuntime({
      ...(!runningOnVercel && token && teamId && projectId ? { credentials: { token, teamId, projectId } } : {}),
      region: process.env.OVERLAY_VERCEL_SANDBOX_REGION?.trim() || 'iad1',
    })
  }
  if (provider === 'daytona') {
    return new DaytonaSandboxRuntime({
      config: { apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL },
    })
  }
  throw managedSandboxError(`Unsupported managed sandbox provider: ${provider}`, 503, 'managed_sandbox_provider_invalid')
}

/**
 * Overlay Cloud environments default to boat boxes when the deployment has
 * box credentials — persistent VMs at ~1/5 the always-on price, with real
 * persistence, snapshots, and desktop streaming. Vercel remains the fallback
 * for box-less deployments; `OVERLAY_MANAGED_SANDBOX_PROVIDER` pins either.
 */
function defaultManagedSandboxProvider(): string {
  return process.env.BOX_API_KEY?.trim() ? 'box' : 'vercel'
}

function managedAllowedDomains(serverUrl: string) {
  return [
    new URL(serverUrl).hostname,
    ...managedHarnessBootstrapDomains(),
    'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.x.ai',
  ]
}

/** Package registries the harness bootstrap needs to install its runtime. */
function managedHarnessBootstrapDomains() {
  return [
    'registry.npmjs.org', '*.npmjs.org',
    'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
  ]
}

/**
 * Egress allowlist for a managed harness sandbox. `serverHost` is optional so
 * reconnect-time recreation works for environments provisioned before the
 * host was recorded in capabilities.
 */
export function managedHarnessAllowedDomainsForHost(serverHost: string | undefined, modelApiHosts: readonly string[]) {
  return [
    ...(serverHost ? [serverHost] : []),
    ...managedHarnessBootstrapDomains(),
    ...modelApiHosts,
  ]
}

function managedHarnessAllowedDomains(serverUrl: string, modelApiHosts: readonly string[]) {
  return managedHarnessAllowedDomainsForHost(new URL(serverUrl).hostname, modelApiHosts)
}

function managedSandboxError(message: string, status: number, code: string) {
  return new ManagedAgentSandboxError(message, status, code)
}

/**
 * Vercel/Daytona images already contain the `overlay-agent-host` binary.
 * Boxes have no custom-image parameter, so the published package installs via
 * `npx` at boot instead of `OVERLAY_AGENT_HOST_IMAGE`.
 */
function agentHostBootstrapCommand(
  provider: string,
  input: Parameters<typeof managedAgentHostCommand>[0],
) {
  const base = managedAgentHostCommand(input)
  if (provider !== 'box') return base
  const pkg = process.env.OVERLAY_AGENT_HOST_PACKAGE?.trim() || '@layernorm/overlay-agent-host'
  return { ...base, command: 'npx', args: ['-y', pkg, ...(base.args ?? [])] }
}
