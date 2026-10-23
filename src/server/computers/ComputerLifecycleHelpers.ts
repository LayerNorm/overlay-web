import type { Computer } from '@overlay/workspace-contracts'
import type { AgentSandboxLease, ComputerOwnerType } from '@overlay/workspace-contracts'
import type { ConnectedAgentRepository } from '@/server/agents/ConnectedAgentRepository'
import type { ComputerBilling } from './ComputerBilling'
import type { ComputerRepository } from './ComputerRepository'

export function createComputerRecipe(computer: Computer, sessionMs: number) {
  const size = computer.size
  return {
    name: computer.name ?? `computer-${computer.id}`,
    persistent: true,
    environment: {
      OVERLAY_WORKSPACE_ID: computer.workspaceId,
      OVERLAY_COMPUTER_ID: computer.id,
      OVERLAY_OWNER_TYPE: computer.ownerType,
      OVERLAY_OWNER_ID: computer.ownerId,
    },
    networkPolicy: { mode: 'allow_all' as const },
    idleTimeoutMs: 0,
    hardTimeoutMs: sessionMs,
    resources: {
      vcpus: size === 'small' ? 2 : size === 'large' ? 8 : 4,
      memoryGiB: size === 'small' ? 4 : size === 'large' ? 16 : 8,
      diskGiB: size === 'small' ? 40 : size === 'large' ? 100 : 80,
    },
  }
}

export function hasMatchingStoppedEvidence(
  computer: Computer,
  usage: Record<string, unknown>,
  providerReference?: string,
): boolean {
  const evidence = usage.lastProviderEvidence as {
    stopped?: boolean
    providerReference?: string
    usage?: unknown
    observedAt?: number
  } | undefined
  const reference = providerReference ?? computer.providerRef ?? undefined
  const invalidatedAt = typeof usage.stoppedEvidenceInvalidatedAt === 'number'
    ? usage.stoppedEvidenceInvalidatedAt
    : 0
  return Boolean(reference && evidence?.stopped && evidence.providerReference === reference
    && usage.meteredProviderReference === reference
    && typeof evidence.observedAt === 'number' && evidence.observedAt > invalidatedAt
    && evidence.usage && typeof evidence.usage === 'object')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isMissingSandboxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /404|not found|does not exist|gone/i.test(message)
}

type ComputerLeaseHandlerDependencies = {
  repository: Pick<ComputerRepository, 'get'>
  leases: Pick<ConnectedAgentRepository, 'computerHasActiveRuns'>
  billing: Pick<ComputerBilling, 'lease'>
  assertCanRun(input: { workspaceId: string; userId: string; agentId?: string }): Promise<void>
  now(): number
  stop(computer: Computer, actorUserId: string, explicitDelete?: boolean, idle?: boolean): Promise<void>
  provision(args: {
    actorUserId: string
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    size: Computer['size']
    name?: string
  }): Promise<Computer>
}

type ComputerLifecycleUsage = {
  maintenance?: { kind?: string; token?: string; expiresAt?: number }
  activityTokens?: Record<string, { expiresAt?: number }>
}

export async function handleComputerLease(
  lease: AgentSandboxLease,
  reason: string | undefined,
  dependencies: ComputerLeaseHandlerDependencies,
) {
  if (!lease.computerId) return { leaseId: lease.id, outcome: 'skipped' as const }
  const computer = await dependencies.repository.get(lease.computerId)
  if (!computer) return lease.status === 'released'
    ? { leaseId: lease.id, outcome: 'released' as const }
    : { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: 'computer_row_missing' }
  const now = dependencies.now()
  const lifecycle = lease.usage.computerLifecycle as ComputerLifecycleUsage | undefined
  const maintenance = lifecycle?.maintenance
  if (maintenance && (maintenance.expiresAt ?? 0) > now) {
    return { leaseId: lease.id, outcome: 'skipped' as const, reason: 'maintenance_in_progress' }
  }
  if (maintenance?.kind === 'wake') return await reconcileWake(lease, computer, dependencies)
  if (maintenance?.kind === 'provision') return await reconcileProvision(lease, computer, dependencies)
  if (maintenance && !['stop', 'idle', 'delete'].includes(maintenance.kind ?? '')) {
    return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: 'maintenance_reconciliation_required' }
  }
  return await handleComputerCleanup(lease, computer, reason, maintenance, lifecycle, now, dependencies)
}

async function reconcileWake(
  lease: AgentSandboxLease,
  computer: Computer,
  dependencies: ComputerLeaseHandlerDependencies,
) {
  try {
    await dependencies.stop(computer, 'computer-cleanup')
    return { leaseId: lease.id, outcome: 'killed' as const, reason: 'expired_wake_paused' }
  } catch (error) {
    return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
  }
}

async function reconcileProvision(
  lease: AgentSandboxLease,
  computer: Computer,
  dependencies: ComputerLeaseHandlerDependencies,
) {
  if (computer.providerRef) {
    try {
      await dependencies.stop(computer, computer.createdBy)
      return { leaseId: lease.id, outcome: 'killed' as const, reason: 'provision_reconciliation' }
    } catch (error) {
      return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
    }
  }
  const actorUserId = (lease.usage.computerLifecycle as {
    maintenance?: { actorUserId?: string }
  } | undefined)?.maintenance?.actorUserId
  if (!actorUserId) {
    return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: 'provision_actor_missing' }
  }
  try {
    await dependencies.assertCanRun({
      workspaceId: computer.workspaceId, userId: actorUserId,
      ...(computer.ownerType === 'agent' ? { agentId: computer.ownerId } : {}),
    })
    const ready = await dependencies.provision({
      actorUserId, workspaceId: computer.workspaceId,
      ownerType: computer.ownerType, ownerId: computer.ownerId, size: computer.size,
      name: computer.name ?? undefined,
    })
    return { leaseId: lease.id, outcome: ready.providerRef ? 'adopted' as const : 'cleanup_failed' as const }
  } catch (error) {
    return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
  }
}

async function handleComputerCleanup(
  lease: AgentSandboxLease,
  computer: Computer,
  reason: string | undefined,
  maintenance: ComputerLifecycleUsage['maintenance'],
  lifecycle: ComputerLifecycleUsage | undefined,
  now: number,
  dependencies: ComputerLeaseHandlerDependencies,
) {
  const stopReason = reason ?? (maintenance?.kind === 'delete' ? 'delete_retry' : 'cleanup_retry')
  const hardExpiry = lease.status === 'running' && typeof lease.reservedUntil === 'number' && lease.reservedUntil <= now
  const wantsIdle = ['cleanup_retry', 'idle_check'].includes(stopReason) && !maintenance && !hardExpiry
  if (wantsIdle) {
    const idleOutcome = await idleCleanupOutcome(lease, computer, lifecycle, now, dependencies)
    if (idleOutcome) return idleOutcome
  }
  const deletion = maintenance?.kind === 'delete'
  try {
    await dependencies.stop(computer, computer.createdBy, deletion, wantsIdle)
    return { leaseId: lease.id, outcome: 'killed' as const, reason: hardExpiry ? 'lease_expired' : (reason ?? 'idle_timeout') }
  } catch (error) {
    if (error instanceof Error && error.message === 'COMPUTER_MAINTENANCE_IN_PROGRESS' && wantsIdle) {
      return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_active' }
    }
    return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
  }
}

async function idleCleanupOutcome(
  lease: AgentSandboxLease,
  computer: Computer,
  lifecycle: ComputerLifecycleUsage | undefined,
  now: number,
  dependencies: ComputerLeaseHandlerDependencies,
) {
  const activeAction = Object.values(lifecycle?.activityTokens ?? {}).some((activity) =>
    (activity.expiresAt ?? 0) > now)
  if (activeAction) return { leaseId: lease.id, outcome: 'skipped' as const, reason: 'computer_active' }
  const lastActiveAt = computer.lastActiveAt ?? computer.updatedAt ?? computer.createdAt
  if (now - lastActiveAt < 10 * 60_000) {
    return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_not_idle' }
  }
  const activeRun = await dependencies.leases.computerHasActiveRuns?.({
    workspaceId: computer.workspaceId, ownerType: computer.ownerType, ownerId: computer.ownerId, now,
  })
  return activeRun ? { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_has_live_run' } : null
}
