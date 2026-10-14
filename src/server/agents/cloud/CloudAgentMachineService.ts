import 'server-only'

import { logger } from '@/server/observability/logger'
import { randomUUID } from 'node:crypto'
import type { SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import type { AgentBinding, AgentEnvironment, AgentSandboxLease, ComputerSize } from '@overlay/workspace-contracts'
import type { AuditService } from '@/server/admin'
import type { ConnectedAgentControlPlaneService } from '../ConnectedAgentControlPlaneService'
import type { ConnectedAgentRepository } from '../ConnectedAgentRepository'
import type { CloudAgentProvisionRepository } from './CloudAgentProvisionRepository'
import {
  deriveCloudAgentState,
  type CloudAgentAction,
  type CloudAgentPhase,
  type CloudAgentStatus,
} from '@/shared/agents/cloud-agent'
import type { AgentProfileBundle } from '@layernorm/overlay-agent-bridge-protocol'
import { CLAUDE_JSON_PATH, planProfileApply, PROFILE_HARNESS_HOME, PROFILE_MANAGED_PATH, type ManagedProfile } from '../profiles/agent-profile-apply'
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
  'createEnrollmentSession' | 'approveEnvironment' | 'upsertBinding' | 'revokeEnvironment' | 'sweepRemoteRuns'>
type Repository = Pick<ConnectedAgentRepository,
  'listEnvironments' | 'getEnvironment' | 'createSandboxLease' | 'getActiveSandboxLease' | 'patchSandboxLeaseUsage' | 'listBindings'>

/** The account an agent runs on, as the person sees it. */
export type CloudAgentAccountSummary = { id: string; label: string; provider: string; method: string; status: 'active' | 'needs_reauth' }

const SIZE_BY_VCPUS: Record<number, string> = { 2: 'small', 4: 'default', 8: 'large' }

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
    provisions: CloudAgentProvisionRepository
    /** Looks up the account a binding chose, for the agent page. */
    accountSummary?: (userId: string, accountId: string) => Promise<CloudAgentAccountSummary | null>
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
    providerAccountId: string
    size: ComputerSize
    serverUrl: string
  }) {
    const phase = (next: CloudAgentPhase, extra: { error?: string; environmentId?: string } = {}) =>
      this.dependencies.provisions.setPhase({ workspaceId: args.workspaceId, agentId: args.agentId, phase: next, now: this.now(), ...extra })
        .catch((error) => logger.warn('[cloud-agent] could not record the provisioning phase', {
          error: error instanceof Error ? error.message : String(error),
        }))
    await phase('allocating')
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
      await phase('booting')
      await this.runDetached(machine, cloudAgentConnectCommand({
        enrollmentCode: enrollment.code,
        serverUrl: args.serverUrl,
        name,
        adapterId: args.adapterId,
      }))
      await phase('connecting')
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
      await phase('ready', { environmentId: environment.id })
      const { publicKey: _publicKey, ...publicEnvironment } = environment
      return { environment: publicEnvironment, lease: { id: lease.id, status: lease.status }, binding }
    } catch (error) {
      await this.abandon(args, machine, environment)
      await phase('failed', { error: provisionFailureMessage(error) })
      throw error
    }
  }

  /**
   * An agent whose machine is gone (deleted when credit ran out, or by hand) still has its environment and a finished
   * provision record, so provisioning again would be skipped as "already done". This clears both, so a new machine can
   * be provisioned for the same agent. Returns whether it did; a live machine is never touched.
   */
  async reviveIfMachineGone(args: { actorUserId: string; workspaceId: string; agentId: string }): Promise<boolean> {
    const bindings = await this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId })
    const found = await this.cloudBinding(args.workspaceId, bindings)
    if (!found) return false
    const lease = await this.dependencies.repository.getActiveSandboxLease({ workspaceId: args.workspaceId, environmentId: found.environment.id })
    if (lease) return false
    await this.dependencies.controlPlane.revokeEnvironment({
      actorUserId: args.actorUserId, workspaceId: args.workspaceId, environmentId: found.environment.id,
    }).catch((_error) => undefined)
    await this.dependencies.provisions.remove({ workspaceId: args.workspaceId, agentId: args.agentId })
    return true
  }

  /**
   * Everything the agent page shows. The provider is asked for the machine's
   * state (one read), so this is called when the page opens, not per message.
   */
  async status(args: { workspaceId: string; agentId: string }): Promise<CloudAgentStatus> {
    const [provision, bindings] = await Promise.all([
      this.dependencies.provisions.get(args),
      this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId }),
    ])
    const found = await this.cloudBinding(args.workspaceId, bindings)
    const lease = found ? await this.dependencies.repository.getActiveSandboxLease({
      workspaceId: args.workspaceId, environmentId: found.environment.id,
    }) : null
    const machine = lease ? await this.readMachine(lease) : null
    const ownerUserId = typeof found?.binding.adapterConfig.providerAccountOwnerUserId === 'string' ? found.binding.adapterConfig.providerAccountOwnerUserId : ''
    const accountId = typeof found?.binding.adapterConfig.providerAccountId === 'string' ? found.binding.adapterConfig.providerAccountId : ''
    const account = ownerUserId && accountId && this.dependencies.accountSummary
      ? await this.dependencies.accountSummary(ownerUserId, accountId).catch((_error) => null)
      : null
    const parts = {
      provision: provision ? { phase: provision.phase, ...(provision.error ? { error: provision.error } : {}), updatedAt: provision.updatedAt } : null,
      environment: found ? {
        id: found.environment.id, status: found.environment.status,
        ...(found.environment.lastSeenAt ? { lastSeenAt: found.environment.lastSeenAt } : {}), createdAt: found.environment.createdAt,
      } : null,
      machine,
      account,
    }
    const configuredAdapter = found?.binding.adapterConfig.adapterId
    const adapterId = typeof configuredAdapter === 'string' && configuredAdapter ? configuredAdapter : (found?.binding as { adapterId?: string } | undefined)?.adapterId
    return { agentId: args.agentId, ...(adapterId ? { adapterId } : {}), ...parts, state: deriveCloudAgentState({
      ...parts,
      // A host is "online" only while it keeps checking in.
      environment: found ? { ...parts.environment!, status: this.hostFresh(found.environment) ? 'online' : 'offline' } : null,
    }) }
  }

  /** Pause, resume, or restart an agent's machine. */
  async control(args: { workspaceId: string; agentId: string; action: CloudAgentAction }): Promise<void> {
    const bindings = await this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId })
    const found = await this.cloudBinding(args.workspaceId, bindings)
    if (!found) throw new CloudAgentMachineError('This agent has no Overlay Cloud machine', 404, 'cloud_agent_missing')
    const lease = await this.dependencies.repository.getActiveSandboxLease({ workspaceId: args.workspaceId, environmentId: found.environment.id })
    if (!lease?.providerReference) throw new CloudAgentMachineError('This agent\'s machine is not available', 409, 'cloud_agent_unavailable')
    const machine = await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false })
    // Pausing or restarting ends whatever the host was doing, and a replacement host knows nothing of it. Fail the
    // run now, with a message, instead of leaving it to block the next turn until the sweep notices.
    if (args.action === 'pause' || args.action === 'restart') {
      await this.dependencies.controlPlane.sweepRemoteRuns({ abandonEnvironmentId: found.environment.id }).catch((_error) => undefined)
    }
    if (args.action === 'pause') {
      await machine.stop()
      return
    }
    if (args.action === 'resume') {
      await this.wake({ workspaceId: args.workspaceId, environmentId: found.environment.id })
      return
    }
    // Restart: make sure the machine is up, then replace the host process.
    if (await machine.status() !== 'running') await machine.resume()
    await this.runDetached(machine, cloudAgentStopHostCommand())
    await this.runDetached(machine, cloudAgentRunCommand())
    await this.dependencies.repository.patchSandboxLeaseUsage({
      workspaceId: args.workspaceId, leaseId: lease.id, patch: { lastActiveAt: this.now() }, now: this.now(),
      // A machine woken for something other than a run still stops after the idle window.
      idleCheckInMs: MANAGED_SANDBOX_IDLE_TIMEOUT_MS,
    })
  }

  /**
   * Puts an imported profile on the agent's machine: its files under the harness's config folder, its MCP servers in
   * `~/.claude.json`, and the removal of what an earlier version wrote. The machine is woken first (a stopped machine
   * cannot be written to); the host is back up when this returns.
   */
  async applyProfile(args: { workspaceId: string; agentId: string; bundle: AgentProfileBundle; hooksEnabled: boolean; version: number }): Promise<void> {
    const bindings = await this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId })
    const found = await this.cloudBinding(args.workspaceId, bindings)
    if (!found) throw new CloudAgentMachineError('This agent has no Overlay Cloud machine to apply a profile to', 409, 'cloud_agent_missing')
    const woke = await this.wake({ workspaceId: args.workspaceId, environmentId: found.environment.id })
    const lease = await this.dependencies.repository.getActiveSandboxLease({ workspaceId: args.workspaceId, environmentId: found.environment.id })
    if (woke === 'unavailable' || !lease?.providerReference) throw new CloudAgentMachineError('This agent\'s machine is not available', 409, 'cloud_agent_unavailable')
    const machine = await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false })
    const text = async (path: string) => { const bytes = await machine.readFile(path).catch((_error) => null); return bytes ? new TextDecoder().decode(bytes) : null }
    let previous: ManagedProfile | null = null
    try { const raw = await text(PROFILE_MANAGED_PATH); previous = raw ? JSON.parse(raw) as ManagedProfile : null } catch (_error) { previous = null }
    const existingClaudeJson = args.bundle.harness === 'claude-code' ? await text(CLAUDE_JSON_PATH) : null
    let planned
    try {
      planned = planProfileApply({ bundle: args.bundle, hooksEnabled: args.hooksEnabled, version: args.version, previous, existingClaudeJson })
    } catch (_error) {
      throw new CloudAgentMachineError('The machine\'s existing Claude configuration could not be read, so nothing was changed.', 409, 'profile_apply_blocked')
    }
    const { plan, claudeJson } = planned
    const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
    if (plan.removes.length > 0) {
      await this.runDetachedWait(machine, `rm -f ${plan.removes.map(shellQuote).join(' ')}`)
      // Folders a removed file leaves empty go too (never the harness's own folder). rmdir refuses a folder that still
      // holds anything, so a person's own files are safe.
      const home = PROFILE_HARNESS_HOME[args.bundle.harness]
      const empty = new Set<string>()
      for (const path of plan.removes) {
        for (let dir = path.slice(0, path.lastIndexOf('/')); dir.startsWith(`${home}/`); dir = dir.slice(0, dir.lastIndexOf('/'))) empty.add(dir)
      }
      const deepestFirst = [...empty].sort((left, right) => right.split('/').length - left.split('/').length)
      if (deepestFirst.length > 0) await this.runDetachedWait(machine, `rmdir ${deepestFirst.map(shellQuote).join(' ')} 2>/dev/null; true`)
    }
    const directories = [...new Set(plan.writes.map((write) => write.path.slice(0, write.path.lastIndexOf('/'))))]
    for (let index = 0; index < directories.length; index += 100) {
      await this.runDetachedWait(machine, `mkdir -p ${directories.slice(index, index + 100).map(shellQuote).join(' ')} /home/user/.overlay`)
    }
    const encoder = new TextEncoder()
    let batch: Array<{ path: string; contents: Uint8Array; mode?: number }> = []
    let batchBytes = 0
    const flush = async () => { if (batch.length) await machine.writeFiles(batch); batch = []; batchBytes = 0 }
    for (const write of plan.writes) {
      const contents = encoder.encode(write.content)
      if (batch.length >= 80 || batchBytes + contents.length > 1_500_000) await flush()
      batch.push({ path: write.path, contents, ...(write.executable ? { mode: 0o755 } : {}) })
      batchBytes += contents.length
    }
    await flush()
    if (claudeJson !== null) await machine.writeFiles([{ path: CLAUDE_JSON_PATH, contents: encoder.encode(claudeJson), mode: 0o600 }])
    await machine.writeFiles([{ path: PROFILE_MANAGED_PATH, contents: encoder.encode(JSON.stringify(plan.manifest)) }])
    await this.audit(args.workspaceId, 'agent_profile.machine_applied', found.environment.id, {
      agentId: args.agentId, version: args.version, files: plan.writes.length, removed: plan.removes.length, mcpServers: plan.manifest.mcpServers.length,
    })
  }

  /**
   * Puts files on an agent's running machine (a Codex subscription's auth.json for a run). The machine is already up:
   * its host asked for them. Paths must be under the home folder.
   */
  async writeFiles(args: { workspaceId: string; environmentId: string; files: Array<{ path: string; contents: string; mode?: number }> }): Promise<void> {
    const lease = await this.dependencies.repository.getActiveSandboxLease({ workspaceId: args.workspaceId, environmentId: args.environmentId })
    if (!lease?.providerReference) throw new CloudAgentMachineError('This agent\'s machine is not available', 409, 'cloud_agent_unavailable')
    for (const file of args.files) {
      if (!file.path.startsWith('/home/user/') || file.path.includes('..')) throw new CloudAgentMachineError('That path is not allowed', 400, 'path_not_allowed')
    }
    const machine = await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false })
    const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
    const directories = [...new Set(args.files.map((file) => file.path.slice(0, file.path.lastIndexOf('/'))))]
    await this.runDetachedWait(machine, `mkdir -p ${directories.map(shellQuote).join(' ')}`)
    const encoder = new TextEncoder()
    await machine.writeFiles(args.files.map((file) => ({ path: file.path, contents: encoder.encode(file.contents), ...(file.mode ? { mode: file.mode } : {}) })))
  }

  /** Stops using the machine: revoke its environment (which ends the lease and its bindings) and delete it now. */
  async teardown(args: { actorUserId: string; workspaceId: string; agentId: string }): Promise<void> {
    const bindings = await this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId })
    const found = await this.cloudBinding(args.workspaceId, bindings)
    if (found) {
      const lease = await this.dependencies.repository.getActiveSandboxLease({ workspaceId: args.workspaceId, environmentId: found.environment.id })
      await this.dependencies.controlPlane.revokeEnvironment({
        actorUserId: args.actorUserId, workspaceId: args.workspaceId, environmentId: found.environment.id,
      })
      if (lease?.providerReference) {
        // The reaper would delete it on its next pass; do it now so no paid machine lingers.
        await (await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false })).delete()
          .catch((_error) => undefined)
      }
    }
    await this.dependencies.provisions.remove({ workspaceId: args.workspaceId, agentId: args.agentId })
  }

  private async runDetachedWait(machine: SandboxInstance, script: string) {
    const result = await (await machine.runCommand({ command: 'bash', args: ['-lc', script], timeoutMs: COMMAND_TIMEOUT_MS })).wait()
    if (result.exitCode !== 0) throw new CloudAgentMachineError('A command on the machine failed while applying the profile.', 502, 'profile_apply_failed')
  }

  private async audit(workspaceId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    await this.dependencies.audit.record({
      action, actorType: 'system', outcome: 'success', resourceType: 'agent_environment', resourceId, workspaceId, metadata,
    } as never).catch((_error) => undefined)
  }

  private async cloudBinding(workspaceId: string, bindings: AgentBinding[]) {
    for (const binding of bindings.filter((candidate) => candidate.enabled)) {
      const environment = await this.dependencies.repository.getEnvironment({ workspaceId, environmentId: binding.environmentId })
      if (environment?.kind === 'overlay_cloud' && environment.status !== 'revoked') return { binding, environment }
    }
    return null
  }

  private async readMachine(lease: AgentSandboxLease): Promise<NonNullable<CloudAgentStatus['machine']>> {
    const usage = lease.usage ?? {}
    const resources = usage.resources as { vcpus?: number } | undefined
    const details = {
      ...(resources?.vcpus && SIZE_BY_VCPUS[resources.vcpus] ? { size: SIZE_BY_VCPUS[resources.vcpus]! } : {}),
      ...(typeof usage.image === 'string' ? { image: usage.image } : {}),
      ...(typeof usage.adapterId === 'string' ? { adapterId: usage.adapterId } : {}),
    }
    if (!lease.providerReference) return { state: 'unknown', ...details }
    try {
      const machine = await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false })
      const status = await machine.status()
      return { state: status === 'running' ? 'running' : status === 'stopped' ? 'stopped' : 'unknown', ...details }
    } catch (_error) {
      return { state: 'unknown', ...details }
    }
  }

  private hostFresh(environment: AgentEnvironment) {
    return environment.status === 'online' && (environment.lastSeenAt ?? 0) >= this.now() - 45_000
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
      idleCheckInMs: MANAGED_SANDBOX_IDLE_TIMEOUT_MS,
    })
    return status === 'running' ? 'running' : 'resumed'
  }

  private async hostIsOnline(args: { workspaceId: string; environmentId: string }) {
    const environment = await this.dependencies.repository.getEnvironment(args)
    return Boolean(environment && this.hostFresh(environment))
  }

  private async createLease(
    workspaceId: string,
    environmentId: string,
    provider: string,
    providerReference: string,
    details: { resources: unknown; adapterId: string; agentId: string; image: string },
  ): Promise<AgentSandboxLease> {
    const now = this.now()
    const created = await this.dependencies.repository.createSandboxLease({
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
    // The machine starts idle: its first idle check is one window from now (a run's end restarts it).
    await this.dependencies.repository.patchSandboxLeaseUsage({
      workspaceId, leaseId: created.id, patch: {}, now, idleCheckInMs: MANAGED_SANDBOX_IDLE_TIMEOUT_MS,
    }).catch((_error) => undefined)
    return created
  }

  /** The host advertises its adapters on its first poll; binding needs them. */
  private async bindWhenOnline(args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    environmentId: string
    adapterId: CloudAgentAdapterId
    providerAccountId: string
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
          providerAccountId: args.providerAccountId,
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

/** What a person is told when a machine fails to start: known causes by name, everything else generically. */
export function provisionFailureMessage(error: unknown): string {
  if (error instanceof CloudAgentMachineError) return error.message
  const message = error instanceof Error ? error.message : ''
  if (/credit|balance|quota|limit/i.test(message)) return 'The machine provider is out of capacity or credit. Try again later.'
  return 'Could not start the machine. Try again.'
}
