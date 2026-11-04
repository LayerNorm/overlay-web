import 'server-only'

import type { AgentEnvironment, AgentSandboxLease } from '@overlay/workspace-contracts'
import { isMissingSandboxError } from '@/server/computers/ComputerLifecycleHelpers'
import type { AuditService } from '@/server/admin'
import type { ConnectedAgentRepository } from '../ConnectedAgentRepository'
import type { CloudAgentProvisionRecord, CloudAgentProvisionRepository } from './CloudAgentProvisionRepository'
import { deriveCloudAgentState, type CloudAgentStatus } from '@/shared/agents/cloud-agent'
import { managedSandboxRuntimeFromEnv } from '../managed-sandbox-runtime'
import type { SandboxRuntime } from '@overlay/sandbox-runtime'

type RetirementControlPlane = Pick<ConnectedAgentControlPlane, 'revokeEnvironment'>

type ConnectedAgentControlPlane = {
  revokeEnvironment(args: { actorUserId: string; workspaceId: string; environmentId: string }): Promise<void>
}

export class RetiredCloudAgentError extends Error {
  constructor(message: string, readonly statusCode = 410, readonly code = 'hosted_runtime_retired') {
    super(message)
    this.name = 'RetiredCloudAgentError'
  }
}

export class RetiredCloudAgentService {
  constructor(private readonly dependencies: {
    audit: AuditService
    controlPlane: RetirementControlPlane
    repository: Pick<ConnectedAgentRepository, 'listBindings' | 'getEnvironment' | 'getActiveSandboxLease' | 'listSandboxLeases'>
    provisions: Pick<CloudAgentProvisionRepository, 'get' | 'listReclaimable' | 'claimReclaim' | 'markReclaimPending' | 'finishReclaim'>
    runtime?: (provider?: string) => SandboxRuntime
    now?: () => number
  }) {}

  async status(args: { workspaceId: string; agentId: string }): Promise<CloudAgentStatus> {
    const [provision, bindings] = await Promise.all([
      this.dependencies.provisions.get(args),
      this.dependencies.repository.listBindings(args),
    ])
    let environment: AgentEnvironment | null = null
    for (const binding of bindings) {
      const candidate = await this.dependencies.repository.getEnvironment({
        workspaceId: args.workspaceId,
        environmentId: binding.environmentId,
      })
      if (candidate?.kind === 'overlay_cloud') {
        environment = candidate
        break
      }
    }
    if (!environment && provision?.environmentId) {
      const candidate = await this.dependencies.repository.getEnvironment({
        workspaceId: args.workspaceId,
        environmentId: provision.environmentId,
      })
      if (candidate?.kind === 'overlay_cloud') environment = candidate
    }
    const lease = environment
      ? await this.findCleanupLease(args.workspaceId, environment.id)
      : null
    const machine = lease ? await this.readMachine(lease) : null
    const parts = {
      provision: provision
        ? { phase: provision.phase, ...(provision.error ? { error: provision.error } : {}), updatedAt: provision.updatedAt }
        : null,
      environment: environment
        ? {
          id: environment.id,
          status: environment.status,
          ...(environment.lastSeenAt ? { lastSeenAt: environment.lastSeenAt } : {}),
          createdAt: environment.createdAt,
        }
        : null,
      machine,
      account: null,
    }
    const adapterId = provisionAdapterId(bindings)
    return {
      agentId: args.agentId,
      ...(adapterId ? { adapterId } : {}),
      ...parts,
      state: deriveCloudAgentState({
        ...parts,
        environment: environment
          ? {
            ...parts.environment!,
            status: environment.status !== 'revoked'
              && (environment.lastSeenAt ?? 0) >= this.now() - 45_000
              ? 'online'
              : 'offline',
          }
          : null,
      }),
    }
  }

  async teardown(args: { actorUserId: string; workspaceId: string; agentId: string }): Promise<{ cleanupPending: number }> {
    const [provision, bindings] = await Promise.all([
      this.dependencies.provisions.get({ workspaceId: args.workspaceId, agentId: args.agentId }),
      this.dependencies.repository.listBindings({ workspaceId: args.workspaceId, agentId: args.agentId }),
    ])
    const environmentIds = new Set(bindings.map((binding) => binding.environmentId))
    if (provision?.environmentId) environmentIds.add(provision.environmentId)
    let cleanupPending = 0
    if (provision?.providerReference && provision.allocationKey) {
      await this.dependencies.provisions.markReclaimPending({
        workspaceId: args.workspaceId,
        agentId: args.agentId,
        allocationKey: provision.allocationKey,
        now: this.now(),
      })
    }
    for (const environmentId of environmentIds) {
      const environment = await this.dependencies.repository.getEnvironment({
        workspaceId: args.workspaceId,
        environmentId,
      })
      if (environment?.kind !== 'overlay_cloud') continue
      const lease = await this.findCleanupLease(args.workspaceId, environmentId)
      if (lease && lease.status !== 'released') cleanupPending += 1
      if (environment.status !== 'revoked') {
        await this.dependencies.controlPlane.revokeEnvironment({
          actorUserId: args.actorUserId,
          workspaceId: args.workspaceId,
          environmentId,
        })
      }
    }
    if (provision?.providerReference) {
      const environment = provision.environmentId
        ? await this.dependencies.repository.getEnvironment({
          workspaceId: args.workspaceId,
          environmentId: provision.environmentId,
        })
        : null
      const lease = environment
        ? await this.findCleanupLease(args.workspaceId, environment.id)
        : null
      if (!provision.provider || !lease || lease.providerReference !== provision.providerReference) cleanupPending += 1
    } else if (provision?.allocationKey) {
      cleanupPending += 1
    }
    return { cleanupPending }
  }

  async reclaimAbandonedProvisions(args: { limit?: number } = {}): Promise<{ reclaimed: number; skipped: number; failed: number }> {
    const rows = await this.dependencies.provisions.listReclaimable({
      before: this.now() - 10 * 60_000,
      limit: Math.max(1, Math.min(50, Number.isFinite(args.limit) ? Math.floor(args.limit!) : 20)),
    })
    const summary = { reclaimed: 0, skipped: 0, failed: 0 }
    for (const row of rows) summary[await this.reclaimAbandonedProvision(row)] += 1
    return summary
  }

  private async reclaimAbandonedProvision(row: CloudAgentProvisionRecord): Promise<'reclaimed' | 'skipped' | 'failed'> {
    if (!row.providerReference || !row.provider || !row.allocationKey) return 'skipped'
    try {
      const claimed = row.reclaimPending
        ? row
        : await this.dependencies.provisions.claimReclaim({
          workspaceId: row.workspaceId,
          agentId: row.agentId,
          expectedUpdatedAt: row.updatedAt,
          now: this.now(),
        })
      if (!claimed) return 'skipped'
      const { providerReference, allocationKey, provider } = claimed
      if (!providerReference || !allocationKey || !provider) return 'skipped'
      if (await this.leaseOwnsProvision(claimed, providerReference)) return 'skipped'
      await this.deleteReclaimableMachine(provider, providerReference)
      if (claimed.environmentId) {
        const environment = await this.dependencies.repository.getEnvironment({
          workspaceId: claimed.workspaceId,
          environmentId: claimed.environmentId,
        })
        if (environment?.kind === 'overlay_cloud' && environment.status !== 'revoked') {
          await this.dependencies.controlPlane.revokeEnvironment({
            actorUserId: claimed.userId,
            workspaceId: claimed.workspaceId,
            environmentId: claimed.environmentId,
          })
        }
      }
      const finished = await this.dependencies.provisions.finishReclaim({
        workspaceId: claimed.workspaceId,
        agentId: claimed.agentId,
        allocationKey,
        providerReference,
        now: this.now(),
      })
      if (!finished) throw new Error('CLOUD_AGENT_RECLAIM_STATE_CHANGED')
      await this.dependencies.audit.record({
        action: 'agent_environment.cloud_allocation_reclaimed',
        actorType: 'system',
        outcome: 'success',
        resourceType: 'agent_environment',
        ...(claimed.environmentId ? { resourceId: claimed.environmentId } : {}),
        metadata: {
          workspaceId: claimed.workspaceId,
          agentId: claimed.agentId,
          provider,
          allocationKey,
          providerReference,
        },
      }).catch((_error) => undefined)
      return 'reclaimed'
    } catch (_error) {
      return 'failed'
    }
  }

  private async leaseOwnsProvision(row: CloudAgentProvisionRecord, providerReference: string): Promise<boolean> {
    if (!row.environmentId) return false
    const lease = await this.findCleanupLease(row.workspaceId, row.environmentId)
    return lease?.providerReference === providerReference
  }

  private async findCleanupLease(workspaceId: string, environmentId: string): Promise<AgentSandboxLease | null> {
    const active = await this.dependencies.repository.getActiveSandboxLease({ workspaceId, environmentId })
    if (active) return active
    return (await this.dependencies.repository.listSandboxLeases({ statuses: ['cleanup_failed'], limit: 1000 }))
      .find((lease) => lease.workspaceId === workspaceId && lease.environmentId === environmentId) ?? null
  }

  private async deleteReclaimableMachine(provider: string, providerReference: string): Promise<void> {
    const runtime = this.runtime(provider)
    try {
      const machine = await runtime.reconnect(providerReference, { resume: false })
      await machine.delete()
    } catch (error) {
      if (isMissingSandboxError(error)) return
      throw error
    }
    // A successful delete request can be asynchronous: retain ownership and retry
    // until a fresh provider lookup confirms the machine is actually absent.
    try {
      await runtime.reconnect(providerReference, { resume: false })
    } catch (error) {
      if (isMissingSandboxError(error)) return
      throw error
    }
    throw new Error('CLOUD_AGENT_DELETE_NOT_CONFIRMED')
  }

  private async readMachine(lease: AgentSandboxLease): Promise<NonNullable<CloudAgentStatus['machine']>> {
    const usage = lease.usage ?? {}
    const resources = usage.resources as { vcpus?: number } | undefined
    const size = resources?.vcpus === 2 ? 'small' : resources?.vcpus === 4 ? 'default' : resources?.vcpus === 8 ? 'large' : undefined
    const details = {
      ...(size ? { size } : {}),
      ...(typeof usage.image === 'string' ? { image: usage.image } : {}),
      ...(typeof usage.adapterId === 'string' ? { adapterId: usage.adapterId } : {}),
    }
    if (!lease.providerReference) return { state: 'unknown', ...details }
    try {
      const state = await this.runtime(lease.provider).reconnect(lease.providerReference, { resume: false }).then((machine) => machine.status())
      return { state: state === 'running' ? 'running' : state === 'stopped' ? 'stopped' : 'unknown', ...details }
    } catch (_error) {
      return { state: 'unknown', ...details }
    }
  }

  private runtime(provider?: string): SandboxRuntime {
    return this.dependencies.runtime?.(provider) ?? managedSandboxRuntimeFromEnv(provider)
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
}

function provisionAdapterId(bindings: Array<{ environmentId: string; adapterConfig: Record<string, unknown> }>) {
  const value = bindings.map((binding) => binding.adapterConfig.adapterId).find((id) => typeof id === 'string')
  return typeof value === 'string' ? value : undefined
}
