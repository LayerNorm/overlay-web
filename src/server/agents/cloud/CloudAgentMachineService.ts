import 'server-only'

import { randomUUID } from 'node:crypto'
import type { SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import type { AgentEnvironment, AgentSandboxLease, ComputerSize } from '@overlay/workspace-contracts'
import type { AuditService } from '@/server/admin'
import type { ConnectedAgentControlPlaneService } from '../ConnectedAgentControlPlaneService'
import type { ConnectedAgentRepository } from '../ConnectedAgentRepository'
import { MANAGED_SANDBOX_IDLE_TIMEOUT_MS, managedSandboxRuntimeFromEnv } from '../managed-sandbox-runtime'
import {
  CLOUD_AGENT_RESOURCES,
  CLOUD_AGENT_WORKSPACE,
  cloudAgentConnectCommand,
  cloudAgentImageFromEnv,
  cloudAgentRunCommand,
  cloudAgentStopHostCommand,
  type CloudAgentAdapterId,
} from './cloud-agent-machine'

const ENROLLMENT_WAIT_ATTEMPTS = 180
const ENROLLMENT_POLL_MS = 1_000
const COMMAND_TIMEOUT_MS = 60_000

export class CloudAgentMachineError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'CloudAgentMachineError'
  }
}

type ControlPlane = Pick<ConnectedAgentControlPlaneService,
  'createEnrollmentSession' | 'approveEnvironment' | 'upsertBinding' | 'revokeEnvironment'>
type Repository = Pick<ConnectedAgentRepository,
  'listEnvironments' | 'getEnvironment' | 'createSandboxLease' | 'getActiveSandboxLease' | 'patchSandboxLeaseUsage'>

/**
 * Overlay Cloud agent machines: one Boat machine per agent, booted from the
 * Overlay agent image, running the same Agent Host as a user's own computer.
 *
 * Provisioning mints a single-use enrollment code, boots the machine with the
 * host redeeming it, then approves the resulting environment itself — Overlay
 * created the machine, so there is no phrase for a person to confirm — with the
 * filesystem fixed to the machine's workspace. Idle-stop and deletion reuse the
 * sandbox lease meter and reaper (`ManagedAgentSandboxBilling`).
 */
export class CloudAgentMachineService {
  constructor(private readonly dependencies: {
    audit: AuditService
    controlPlane: ControlPlane
    repository: Repository
    runtime?: SandboxRuntime
    image?: string
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  }) {}

  async provision(args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    adapterId: CloudAgentAdapterId
    size: ComputerSize
    serverUrl: string
  }) {
    const runtime = this.runtime()
    const enrollment = await this.dependencies.controlPlane.createEnrollmentSession({
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
    })
    const name = `overlay-cloud-${enrollment.enrollmentSessionId.slice(0, 8).toLowerCase()}`
    const resources = CLOUD_AGENT_RESOURCES[args.size]
    let machine: SandboxInstance | null = null
    let environment: AgentEnvironment | null = null
    try {
      machine = await runtime.create({
        name,
        snapshotId: this.dependencies.image ?? cloudAgentImageFromEnv(),
        persistent: true,
        // Boat has no egress policy. Nothing durable worth taking lives on the
        // machine: the enrollment code is single-use, the host credential is
        // short-lived, and provider credentials arrive per run in memory.
        networkPolicy: { mode: 'allow_all' },
        idleTimeoutMs: MANAGED_SANDBOX_IDLE_TIMEOUT_MS,
        hardTimeoutMs: 0,
        resources,
        metadata: { overlay: 'true', kind: 'cloud-agent', workspace: args.workspaceId, agent: args.agentId },
      })
      await this.runDetached(machine, cloudAgentConnectCommand({
        enrollmentCode: enrollment.code,
        serverUrl: args.serverUrl,
        name,
        adapterId: args.adapterId,
      }))
      environment = await this.waitForEnrollment(args.workspaceId, name)
      await this.dependencies.controlPlane.approveEnvironment({
        actorUserId: args.actorUserId,
        workspaceId: args.workspaceId,
        environmentId: environment.id,
        filesystemGrant: { mode: 'selected_roots', roots: [CLOUD_AGENT_WORKSPACE] },
      })
      const lease = await this.createLease(args.workspaceId, environment.id, runtime.provider, machine.reference, {
        resources, adapterId: args.adapterId, agentId: args.agentId, image: this.dependencies.image ?? cloudAgentImageFromEnv(),
      })
      const binding = await this.bindWhenOnline({ ...args, environmentId: environment.id })
      await this.dependencies.audit.record({
        action: 'agent_environment.cloud_provisioned',
        actorType: 'user',
        actorUserId: args.actorUserId,
        outcome: 'success',
        resourceType: 'agent_environment',
        resourceId: environment.id,
        metadata: { workspaceId: args.workspaceId, agentId: args.agentId, adapterId: args.adapterId, leaseId: lease.id, size: args.size },
      })
      const { publicKey: _publicKey, ...publicEnvironment } = environment
      return { environment: publicEnvironment, lease: { id: lease.id, status: lease.status }, binding }
    } catch (error) {
      await this.abandon(args, machine, environment)
      throw error
    }
  }

  /**
   * Make sure the agent's machine is running with a live host. Called when a
   * turn is queued for an offline Overlay Cloud environment: the lease meter
   * stops idle machines, and a stopped machine has no host process.
   */
  async wake(args: { workspaceId: string; environmentId: string }): Promise<'running' | 'resumed' | 'unavailable'> {
    const lease = await this.dependencies.repository.getActiveSandboxLease(args)
    if (!lease?.providerReference || lease.status !== 'running') return 'unavailable'
    const runtime = this.runtime(lease.provider)
    const machine = await runtime.reconnect(lease.providerReference, { resume: false })
    const status = await machine.status()
    if (status === 'running' && await this.hostIsOnline(args)) return 'running'
    if (status !== 'running') await machine.resume()
    await this.runDetached(machine, cloudAgentStopHostCommand())
    await this.runDetached(machine, cloudAgentRunCommand())
    await this.dependencies.repository.patchSandboxLeaseUsage({
      workspaceId: args.workspaceId,
      leaseId: lease.id,
      patch: { lastActiveAt: this.now() },
      now: this.now(),
    })
    return status === 'running' ? 'running' : 'resumed'
  }

  private async hostIsOnline(args: { workspaceId: string; environmentId: string }) {
    const environment = await this.dependencies.repository.getEnvironment(args)
    return environment?.status === 'online' && (environment.lastSeenAt ?? 0) >= this.now() - 45_000
  }

  private async createLease(
    workspaceId: string,
    environmentId: string,
    provider: string,
    providerReference: string,
    details: { resources: unknown; adapterId: string; agentId: string; image: string },
  ): Promise<AgentSandboxLease> {
    const now = this.now()
    return await this.dependencies.repository.createSandboxLease({
      id: randomUUID(),
      workspaceId,
      environmentId,
      provider,
      providerReference,
      status: 'running',
      // An agent's machine has no hard end; the meter stops it when idle.
      reservedUntil: Number.MAX_SAFE_INTEGER,
      runtimeStartedAt: now,
      // meteredUsage/meterVersion seed the billing meter's cursor.
      usage: {
        ...details,
        idleTimeoutMs: MANAGED_SANDBOX_IDLE_TIMEOUT_MS,
        lastActiveAt: now,
        meteredUsage: {},
        meterVersion: 0,
      },
      cleanupAttempts: 0,
      now,
    })
  }

  /** The host advertises its adapters on its first poll; binding needs them. */
  private async bindWhenOnline(args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    environmentId: string
    adapterId: CloudAgentAdapterId
  }) {
    let lastError: unknown
    for (let attempt = 0; attempt < ENROLLMENT_WAIT_ATTEMPTS; attempt += 1) {
      try {
        return await this.dependencies.controlPlane.upsertBinding({
          actorUserId: args.actorUserId,
          workspaceId: args.workspaceId,
          agentId: args.agentId,
          environmentId: args.environmentId,
          adapterId: args.adapterId,
          workingDirectory: CLOUD_AGENT_WORKSPACE,
        })
      } catch (error) {
        lastError = error
        await this.sleep(ENROLLMENT_POLL_MS)
      }
    }
    throw lastError ?? new CloudAgentMachineError('The agent machine did not come online', 504, 'cloud_agent_offline')
  }

  private async waitForEnrollment(workspaceId: string, name: string): Promise<AgentEnvironment> {
    for (let attempt = 0; attempt < ENROLLMENT_WAIT_ATTEMPTS; attempt += 1) {
      const environments = await this.dependencies.repository.listEnvironments({ workspaceId })
      const environment = environments.find((candidate) => candidate.name === name && candidate.kind === 'overlay_cloud')
      if (environment) return environment
      await this.sleep(ENROLLMENT_POLL_MS)
    }
    throw new CloudAgentMachineError('The agent machine did not enroll in time', 504, 'cloud_agent_enrollment_timeout')
  }

  private async runDetached(machine: SandboxInstance, script: string) {
    const handle = await machine.runCommand({ command: 'bash', args: ['-lc', script], timeoutMs: COMMAND_TIMEOUT_MS })
    const result = await handle.wait()
    if (result.exitCode !== 0) {
      throw new CloudAgentMachineError(`Agent machine command failed: ${result.stderr.slice(-500)}`, 502, 'cloud_agent_command_failed')
    }
  }

  private async abandon(
    args: { actorUserId: string; workspaceId: string },
    machine: SandboxInstance | null,
    environment: AgentEnvironment | null,
  ) {
    if (environment) {
      await this.dependencies.controlPlane.revokeEnvironment({
        actorUserId: args.actorUserId,
        workspaceId: args.workspaceId,
        environmentId: environment.id,
      }).catch((_error) => undefined)
    }
    if (machine) await machine.delete().catch((_error) => undefined)
  }

  private runtime(provider?: string): SandboxRuntime {
    return this.dependencies.runtime ?? managedSandboxRuntimeFromEnv(provider)
  }

  private sleep(ms: number) {
    return this.dependencies.sleep?.(ms) ?? new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
}
