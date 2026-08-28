import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  managedAgentHostCommand,
  type OverlayManagedAcpAdapterId,
  type SandboxInstance,
  type SandboxRuntime,
} from '@overlay/sandbox-runtime'
import { DaytonaSandboxRuntime } from '@overlay/sandbox-runtime/daytona'
import { VercelSandboxRuntime } from '@overlay/sandbox-runtime/vercel'
import type { AuditService } from '@/server/admin'
import type { ConnectedAgentControlPlaneService } from './ConnectedAgentControlPlaneService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import type { ConnectedAgentPolicyLimits } from './ConnectedAgentPolicy'

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_HARD_TIMEOUT_MS = 24 * 60 * 60_000
const MANAGED_ROOT = '/workspace'

export class ManagedAgentSandboxService {
  constructor(private readonly dependencies: {
    audit: AuditService
    controlPlane: ConnectedAgentControlPlaneService
    repository: ConnectedAgentRepository
    runtime?: SandboxRuntime
    sleep?: (ms: number) => Promise<void>
    policyLimits?: (input: { userId: string; workspaceId: string }) => Promise<ConnectedAgentPolicyLimits>
  }) {}

  async provision(args: {
    actorUserId: string
    workspaceId: string
    serverUrl: string
    adapterId: OverlayManagedAcpAdapterId
  }) {
    const runtime = this.dependencies.runtime ?? managedSandboxRuntimeFromEnv()
    const limits = await this.dependencies.policyLimits?.({ userId: args.actorUserId, workspaceId: args.workspaceId })
    const idleTimeoutMs = Math.min(DEFAULT_IDLE_TIMEOUT_MS, limits?.maxIdleDurationMs ?? DEFAULT_IDLE_TIMEOUT_MS)
    const hardTimeoutMs = Math.min(DEFAULT_HARD_TIMEOUT_MS, limits?.maxRunTimeMs ?? DEFAULT_HARD_TIMEOUT_MS)
    const image = process.env.OVERLAY_AGENT_HOST_IMAGE?.trim()
    if (!image) throw managedSandboxError('OVERLAY_AGENT_HOST_IMAGE is not configured', 503, 'managed_sandbox_image_missing')
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
        image,
        persistent: true,
        environment: { OVERLAY_MANAGED_ENVIRONMENT: '1' },
        networkPolicy: {
          mode: 'allowlist',
          domains: managedAllowedDomains(args.serverUrl),
          deniedCidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'],
        },
        idleTimeoutMs,
        hardTimeoutMs,
        resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
        metadata: { overlay: 'true', kind: 'agent-host', workspace: args.workspaceId },
      })
      await sandbox.runCommand(managedAgentHostCommand({
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
        usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
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
    || 'vercel'
  if (provider === 'vercel') {
    const token = process.env.VERCEL_TOKEN?.trim()
    const teamId = process.env.VERCEL_TEAM_ID?.trim()
    const projectId = process.env.VERCEL_PROJECT_ID?.trim()
    return new VercelSandboxRuntime({
      ...(token && teamId && projectId ? { credentials: { token, teamId, projectId } } : {}),
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

function managedAllowedDomains(serverUrl: string) {
  return [
    new URL(serverUrl).hostname,
    'registry.npmjs.org', '*.npmjs.org',
    'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
    'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.x.ai',
  ]
}

function managedSandboxError(message: string, status: number, code: string) {
  return new ManagedAgentSandboxError(message, status, code)
}
