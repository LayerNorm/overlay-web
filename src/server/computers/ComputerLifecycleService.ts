import 'server-only'

import type {
  DesktopSandboxInstance,
  DesktopStreamTicket,
  SandboxInstance,
  SandboxRuntime,
} from '@overlay/sandbox-runtime'
import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts'
import type { AgentSandboxLease } from '@overlay/workspace-contracts'
import type { ConnectedAgentRepository } from '@/server/agents/ConnectedAgentRepository'
import {
  createComputerRecipe,
  errorMessage,
  hasMatchingStoppedEvidence,
  isMissingSandboxError,
} from './ComputerLifecycleHelpers'
import { ComputerBilling } from './ComputerBilling'
import type { ComputerLeaseSeed, ComputerRepository } from './ComputerRepository'

const SESSION_MS = 2 * 60 * 60_000
const MAINTENANCE_MS = 6 * 60_000
const ACTIVITY_GRACE_MS = 60_000

type ComputerMaintenance = { kind?: string; token?: string; expiresAt?: number }
type ComputerLifecycleUsage = {
  maintenance?: ComputerMaintenance
  activityTokens?: Record<string, { expiresAt?: number }>
}

export class ComputerLifecycleService {
  constructor(private readonly dependencies: {
    repository: ComputerRepository
    leases: ConnectedAgentRepository
    billing: ComputerBilling
    runtimeFor(provider: string): SandboxRuntime | undefined
    now?: () => number
    newId?: () => string
    sleep?: (ms: number) => Promise<void>
  }) {}

  async provision(args: {
    actorUserId: string
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    size: Computer['size']
    name?: string
  }): Promise<Computer> {
    const claim = await this.claimProvision(args)
    if (!claim.allocate) return claim.computer
    const token = await this.requireMaintenance(claim.computer, 'provision', this.newId(), false)
    return await this.allocateComputer({
      computer: claim.computer, leaseId: claim.leaseId, actorUserId: args.actorUserId, token, createdAt: claim.createdAt,
    })
  }

  private async claimProvision(args: {
    actorUserId: string
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    size: Computer['size']
    name?: string
  }): Promise<{ computer: Computer; leaseId: string; allocate: boolean; createdAt: number }> {
    const now = this.now()
    const existing = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
    const id = existing?.id ?? this.newId()
    const computer: Computer = existing ?? {
      id, workspaceId: args.workspaceId, ownerType: args.ownerType, ownerId: args.ownerId,
      provider: 'box', providerRef: null, size: args.size, status: 'provisioning',
      name: args.name ?? null, createdBy: args.actorUserId, createdAt: now, updatedAt: now, lastActiveAt: null,
    }
    const lease: ComputerLeaseSeed = {
      id: `computer:${id}`, workspaceId: args.workspaceId, computerId: id, provider: computer.provider,
      providerReference: computer.providerRef ?? undefined,
      status: existing?.providerRef ? (existing.status === 'stopped' ? 'paused' : 'running') : 'reserved',
      reservedUntil: now + SESSION_MS,
      usage: existing ? {} : { meteredUsage: {}, meterVersion: 0, allocationProtocol: 'computer-v1' },
      cleanupAttempts: 0, nextMeterAt: now, now,
    }
    const claimed = await this.dependencies.repository.createWithLease(computer, lease)
    if (existing?.providerRef) {
      if (existing.status === 'error') throw new Error('COMPUTER_CLEANUP_REQUIRES_RECONCILIATION')
      return { computer: claimed.computer, leaseId: lease.id, allocate: false, createdAt: now }
    }
    if (existing) await this.assertProvisionRetryable(existing)
    else if (!claimed.created) {
      if (claimed.computer.providerRef) {
        return { computer: claimed.computer, leaseId: lease.id, allocate: false, createdAt: now }
      }
      throw new Error('COMPUTER_ALLOCATION_IN_PROGRESS')
    }
    return { computer: claimed.computer, leaseId: lease.id, allocate: true, createdAt: now }
  }

  private async assertProvisionRetryable(computer: Computer) {
    const lease = await this.dependencies.billing.lease(computer)
    const pending = lease.usage.computerLifecycle as { maintenance?: ComputerMaintenance } | undefined
    if (pending?.maintenance?.token && ['stop', 'idle', 'delete', 'wake'].includes(pending.maintenance.kind ?? '')) {
      throw new Error('COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION')
    }
    if (lease.usage.allocationProtocol !== 'computer-v1' && typeof lease.usage.requestedAt !== 'number') {
      throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
    }
    if (typeof lease.usage.requestedAt !== 'number' && lease.usage.allocationRetryable !== true) {
      throw new Error('COMPUTER_ALLOCATION_IN_PROGRESS')
    }
    if (typeof lease.usage.requestedAt === 'number' && this.now() - lease.usage.requestedAt > 24 * 60 * 60_000) {
      throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
    }
  }

  private async allocateComputer(args: {
    computer: Computer
    leaseId: string
    actorUserId: string
    token: string
    createdAt: number
  }): Promise<Computer> {
    const { computer, leaseId, actorUserId, token, createdAt } = args
    try {
      await this.dependencies.billing.reserve(computer, actorUserId)
      const allocation = await this.prepareAllocation(computer, leaseId)
      const instance = await this.requireRuntime('box').create({
        ...JSON.parse(allocation.recipe) as ReturnType<typeof createComputerRecipe>,
        allocationKey: allocation.allocationKey,
        onAllocated: async (reference) => {
          const bound = await this.dependencies.repository.bindProviderReference({
            computerId: computer.id, workspaceId: computer.workspaceId,
            leaseId, reference, allocationKey: allocation.allocationKey,
          })
          if (!bound) throw new Error('COMPUTER_ALLOCATION_BIND_FAILED')
        },
      })
      await this.dependencies.billing.meter({ ...computer, providerRef: instance.reference }, false)
      const ready = await this.dependencies.repository.update(computer.id, {
        providerRef: instance.reference, status: 'ready', lastActiveAt: createdAt, updatedAt: this.now(),
      })
      await this.releaseMaintenance(ready, token)
      return ready
    } catch (error) {
      await this.recordProvisionFailure(computer, leaseId, token)
      throw error
    }
  }

  private async prepareAllocation(computer: Computer, leaseId: string) {
    const allocationKey = `computer:${computer.id}`
    const storedLease = await this.dependencies.billing.lease(computer)
    const recipe = typeof storedLease.usage.allocationRecipe === 'string'
      ? storedLease.usage.allocationRecipe
      : JSON.stringify(createComputerRecipe(computer, SESSION_MS))
    const prepared = await this.dependencies.leases.prepareComputerAllocation?.({
      workspaceId: computer.workspaceId, leaseId,
      allocationKey, allocationRecipe: recipe, now: this.now(),
    })
    if (!prepared) throw new Error('COMPUTER_ALLOCATION_RECIPE_CONFLICT')
    if (this.now() - prepared.requestedAt > 24 * 60 * 60_000) {
      throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
    }
    return { allocationKey, recipe }
  }

  private async recordProvisionFailure(computer: Computer, leaseId: string, token: string) {
    const lease = await this.dependencies.billing.lease(computer).catch((_error) => null)
    if (!lease) {
      await this.markProvisionCleanupFailed(computer, leaseId, 0)
      return
    }
    const usage = lease.usage ?? {}
    if (typeof usage.requestedAt === 'number'
      || typeof usage.allocationKey === 'string'
      || typeof usage.allocationRecipe === 'string'
      || typeof usage.meteredProviderReference === 'string'
      || computer.providerRef
      || lease.providerReference) {
      await this.markProvisionCleanupFailed(computer, leaseId, lease.cleanupAttempts)
      return
    }
    const holdMicros = typeof usage.runtimeHoldMicros === 'number' ? usage.runtimeHoldMicros : 0
    if (!Number.isSafeInteger(holdMicros) || holdMicros < 0) {
      await this.markProvisionCleanupFailed(computer, leaseId, lease.cleanupAttempts)
      return
    }
    if (holdMicros > 0) {
      try {
        await this.dependencies.billing.releaseReservation(computer)
      } catch (_error) {
        await this.markProvisionCleanupFailed(computer, leaseId, lease.cleanupAttempts)
        return
      }
    }
    await this.dependencies.leases.patchSandboxLeaseUsage({
      workspaceId: computer.workspaceId, leaseId, now: this.now(),
      patch: { allocationRetryable: true },
    }).catch((_error) => undefined)
    await Promise.resolve(this.releaseMaintenance(computer, token)).catch((_error) => undefined)
  }

  private async markProvisionCleanupFailed(computer: Computer, leaseId: string, cleanupAttempts: number) {
    const attempts = cleanupAttempts + 1
    const retryAt = this.cleanupRetryAt(attempts)
    await this.dependencies.leases.updateSandboxLease({
      workspaceId: computer.workspaceId, leaseId, status: 'cleanup_failed',
      cleanupAfter: retryAt, nextMeterAt: retryAt, cleanupAttempts: attempts, now: this.now(),
    })
  }

  async withOwnerOperation<T>(args: {
    actorUserId: string
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    actionDeadlineMs?: number
    operation: (computer: Computer, instance: SandboxInstance) => Promise<T>
  }): Promise<T> {
    const computer = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
    if (!computer || !computer.providerRef) throw new Error('COMPUTER_UNAVAILABLE')
    const lease = await this.dependencies.billing.lease(computer)
    const pending = lease.usage.computerLifecycle as { maintenance?: { kind?: string; token?: string; expiresAt?: number } } | undefined
    if (pending?.maintenance?.token) throw new Error('COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION')
    const runtime = this.requireRuntime(computer.provider)
    const instance = await runtime.reconnect(computer.providerRef, { resume: false })
    const wakeToken = await this.requireMaintenance(computer, 'wake', this.newId(), false)
    try {
      const status = await instance.status()
      if (status === 'stopped' || status === 'archived') {
        await this.dependencies.billing.reserve(computer, args.actorUserId, await instance.usage())
        await instance.resume()
        await this.dependencies.billing.meter(computer)
      } else if (!['running', 'provisioning'].includes(status)) {
        throw new Error('COMPUTER_PROVIDER_UNAVAILABLE')
      }
      const now = this.now()
      await this.dependencies.leases.updateSandboxLease({
        workspaceId: computer.workspaceId, leaseId: lease.id, status: 'running',
        reservedUntil: now + SESSION_MS, now,
      })
      await this.dependencies.repository.update(computer.id, { status: 'ready', updatedAt: now })
    } finally {
      await this.dependencies.leases.releaseComputerMaintenance?.({
        workspaceId: computer.workspaceId, leaseId: lease.id, token: wakeToken, now: this.now(),
      })
    }
    const token = this.newId()
    const claim = await this.dependencies.leases.claimComputerActivity?.({
      workspaceId: computer.workspaceId, leaseId: lease.id, token, userId: args.actorUserId,
      now: this.now(),
      expiresAt: this.now() + Math.min(10 * 60_000, Math.max(1, args.actionDeadlineMs ?? 2 * 60_000)) + ACTIVITY_GRACE_MS,
    })
    if (!claim) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    try {
      await this.dependencies.repository.update(computer.id, { lastActiveAt: this.now(), updatedAt: this.now() })
      await this.dependencies.billing.meter(computer)
      return await args.operation(computer, instance)
    } finally {
      await this.dependencies.leases.releaseComputerActivity?.({
        workspaceId: computer.workspaceId, leaseId: lease.id, token, now: this.now(),
      }).catch((_error) => undefined)
    }
  }

  async handleLease(lease: AgentSandboxLease, reason?: string) {
    if (!lease.computerId) return { leaseId: lease.id, outcome: 'skipped' as const }
    const computer = await this.dependencies.repository.get(lease.computerId)
    if (!computer) return this.missingComputerOutcome(lease)
    const now = this.now()
    const lifecycle = lease.usage.computerLifecycle as ComputerLifecycleUsage | undefined
    const maintenance = lifecycle?.maintenance
    if (this.isMaintenanceActive(maintenance, now)) {
      return { leaseId: lease.id, outcome: 'skipped' as const, reason: 'maintenance_in_progress' }
    }
    if (maintenance?.kind === 'wake') return await this.reconcileWake(lease, computer, maintenance)
    if (maintenance?.kind === 'provision') return await this.reconcileProvision(lease, computer)
    if (maintenance && !['stop', 'idle', 'delete'].includes(maintenance.kind ?? '')) {
      return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: 'maintenance_reconciliation_required' }
    }
    return await this.handleCleanup(lease, computer, reason, maintenance, lifecycle, now)
  }

  private missingComputerOutcome(lease: AgentSandboxLease) {
    return lease.status === 'released'
      ? { leaseId: lease.id, outcome: 'released' as const }
      : { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: 'computer_row_missing' }
  }

  private isMaintenanceActive(maintenance: ComputerMaintenance | undefined, now: number) {
    return Boolean(maintenance && (maintenance.expiresAt ?? 0) > now)
  }

  private async reconcileWake(lease: AgentSandboxLease, computer: Computer, maintenance: ComputerMaintenance) {
    const token = this.newId()
    const claim = await this.dependencies.leases.claimComputerMaintenance?.({
      workspaceId: computer.workspaceId, leaseId: lease.id, kind: 'wake', token,
      now: this.now(), expiresAt: this.now() + MAINTENANCE_MS, reconcileToken: maintenance.token,
    })
    if (!claim) return { leaseId: lease.id, outcome: 'skipped' as const, reason: 'maintenance_reclaimed' }
    try {
      const runtime = this.requireRuntime(computer.provider)
      const instance = computer.providerRef
        ? await runtime.reconnect(computer.providerRef, { resume: false })
        : null
      if (!instance) throw new Error('COMPUTER_PROVIDER_REFERENCE_MISSING')
      if (await instance.status() === 'stopped') {
        await this.dependencies.billing.reserve(computer, computer.createdBy, await instance.usage())
        await instance.resume()
      }
      await this.dependencies.billing.meter(computer)
      await this.dependencies.repository.update(computer.id, { status: 'ready', updatedAt: this.now() })
      await this.releaseMaintenance(computer, token)
      return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'wake_reconciled' }
    } catch (error) {
      return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
    }
  }

  private async reconcileProvision(lease: AgentSandboxLease, computer: Computer) {
    if (computer.providerRef) {
      try {
        await this.stop(computer, computer.createdBy)
        return { leaseId: lease.id, outcome: 'killed' as const, reason: 'provision_reconciliation' }
      } catch (error) {
        return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
      }
    }
    try {
      const ready = await this.provision({
        actorUserId: computer.createdBy, workspaceId: computer.workspaceId,
        ownerType: computer.ownerType, ownerId: computer.ownerId, size: computer.size,
        name: computer.name ?? undefined,
      })
      return { leaseId: lease.id, outcome: ready.providerRef ? 'adopted' as const : 'cleanup_failed' as const }
    } catch (error) {
      return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
    }
  }

  private async handleCleanup(
    lease: AgentSandboxLease,
    computer: Computer,
    reason: string | undefined,
    maintenance: ComputerMaintenance | undefined,
    lifecycle: ComputerLifecycleUsage | undefined,
    now: number,
  ) {
    const stopReason = reason ?? (maintenance?.kind === 'delete' ? 'delete_retry' : 'cleanup_retry')
    const hardExpiry = lease.status === 'running' && typeof lease.reservedUntil === 'number' && lease.reservedUntil <= now
    const wantsIdle = ['cleanup_retry', 'idle_check'].includes(stopReason) && !maintenance && !hardExpiry
    if (wantsIdle) {
      const idleOutcome = await this.idleCleanupOutcome(lease, computer, lifecycle, now)
      if (idleOutcome) return idleOutcome
    }
    const deletion = maintenance?.kind === 'delete'
    try {
      await this.stop(computer, computer.createdBy, deletion, wantsIdle)
      return { leaseId: lease.id, outcome: 'killed' as const, reason: hardExpiry ? 'lease_expired' : (reason ?? 'idle_timeout') }
    } catch (error) {
      if (error instanceof Error && error.message === 'COMPUTER_MAINTENANCE_IN_PROGRESS' && wantsIdle) {
        return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_active' }
      }
      return { leaseId: lease.id, outcome: 'cleanup_failed' as const, reason: errorMessage(error) }
    }
  }

  private async idleCleanupOutcome(
    lease: AgentSandboxLease,
    computer: Computer,
    lifecycle: ComputerLifecycleUsage | undefined,
    now: number,
  ) {
    const activeAction = Object.values(lifecycle?.activityTokens ?? {}).some((activity) =>
      (activity.expiresAt ?? 0) > now)
    if (activeAction) return { leaseId: lease.id, outcome: 'skipped' as const, reason: 'computer_active' }
    if (computer.lastActiveAt === null || now - computer.lastActiveAt < 10 * 60_000) {
      return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_not_idle' }
    }
    const activeRun = await this.dependencies.leases.computerHasActiveRuns?.({
      workspaceId: computer.workspaceId, ownerType: computer.ownerType, ownerId: computer.ownerId, now,
    })
    if (activeRun) return { leaseId: lease.id, outcome: 'adopted' as const, reason: 'computer_has_live_run' }
    return null
  }

  async stop(computer: Computer, actorUserId: string, explicitDelete = false, idle = false): Promise<void> {
    const lease = await this.dependencies.billing.lease(computer)
    const pending = lease.usage.computerLifecycle as { maintenance?: { kind?: string } } | undefined
    const shouldDelete = explicitDelete || pending?.maintenance?.kind === 'delete'
    await this.maintenance(computer, shouldDelete ? 'delete' : idle ? 'idle' : 'stop', async (current, instance) => {
      const lease = await this.dependencies.billing.lease(current)
      if (instance) {
        const initialStatus = await instance.status()
        if (!['stopped', 'archived', 'deleted'].includes(initialStatus)) {
          await instance.stop()
          const status = await instance.status()
          if (!['stopped', 'archived', 'deleted'].includes(status)) throw new Error('COMPUTER_STOP_NOT_CONFIRMED')
        }
      } else if (!hasMatchingStoppedEvidence(current, lease.usage, lease.providerReference)) {
        throw new Error('COMPUTER_STOP_EVIDENCE_MISSING')
      }
      await this.dependencies.billing.meter(current, true)
      if (shouldDelete) {
        if (instance) await instance.delete()
        await this.dependencies.leases.updateSandboxLease({
          workspaceId: current.workspaceId, leaseId: `computer:${current.id}`, status: 'released',
          reservedUntil: this.now(), cleanupAfter: undefined, now: this.now(),
        })
        await this.dependencies.repository.delete(current.id)
      } else {
        await this.dependencies.leases.updateSandboxLease({
          workspaceId: current.workspaceId, leaseId: `computer:${current.id}`, status: 'paused',
          reservedUntil: this.now(), cleanupAfter: undefined, nextMeterAt: undefined, now: this.now(),
        })
        await this.dependencies.repository.update(current.id, { status: 'stopped', updatedAt: this.now() })
      }
    }, actorUserId)
  }

  async openDesktop(computer: Computer, actorUserId: string, mode?: 'webrtc' | 'vnc'): Promise<DesktopStreamTicket> {
    return await this.withOwnerOperation({
      actorUserId, workspaceId: computer.workspaceId, ownerType: computer.ownerType, ownerId: computer.ownerId,
      actionDeadlineMs: 45_000,
      operation: async (_computer, instance) => {
        if (!('desktop' in instance)) throw new Error('COMPUTER_DESKTOP_UNAVAILABLE')
        const desktop = instance as DesktopSandboxInstance
        const deadline = this.now() + 45_000
        for (;;) {
          const ticket = await desktop.desktop({ mode })
          if (ticket.ready || this.now() >= deadline) return ticket
          await this.sleep(3_000)
        }
      },
    })
  }

  private async maintenance(
    computer: Computer,
    kind: 'stop' | 'delete' | 'idle',
    operation: (computer: Computer, instance: SandboxInstance | null) => Promise<void>,
    actorUserId: string,
  ) {
    const lease = await this.dependencies.billing.lease(computer)
    const existing = (lease.usage.computerLifecycle as { maintenance?: { kind?: string; token?: string; expiresAt?: number } } | undefined)?.maintenance
    const token = this.newId()
    const claimedKind = existing?.kind === 'delete' ? 'delete' : kind
    const claim = await this.dependencies.leases.claimComputerMaintenance?.({
      workspaceId: computer.workspaceId, leaseId: lease.id, kind: claimedKind, token, now: this.now(),
      expiresAt: this.now() + MAINTENANCE_MS, force: kind !== 'idle',
      ...(kind === 'idle' ? { idleBefore: this.now() - 10 * 60_000 } : {}),
      ...(existing?.token && (existing.expiresAt ?? 0) <= this.now() ? { reconcileToken: existing.token } : {}),
    })
    if (!claim) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    let completed = false
    try {
      let instance: SandboxInstance | null = null
      try {
        instance = computer.providerRef
          ? await this.requireRuntime(computer.provider).reconnect(computer.providerRef, { resume: false })
          : null
      } catch (error) {
        if (!isMissingSandboxError(error)) throw error
      }
      await operation(computer, instance)
      completed = true
    } catch (error) {
      await this.dependencies.leases.updateSandboxLease({
        workspaceId: computer.workspaceId, leaseId: lease.id, status: 'cleanup_failed',
        cleanupAttempts: lease.cleanupAttempts + 1,
        cleanupAfter: this.cleanupRetryAt(lease.cleanupAttempts + 1),
        nextMeterAt: this.cleanupRetryAt(lease.cleanupAttempts + 1), now: this.now(),
      })
      throw error
    } finally {
      if (completed) {
      await this.dependencies.leases.releaseComputerMaintenance?.({
        workspaceId: computer.workspaceId, leaseId: lease.id, token, now: this.now(),
      })
      }
    }
    void actorUserId
  }

  private async requireMaintenance(computer: Computer, kind: 'provision' | 'wake', token: string, force: boolean): Promise<string> {
    const lease = await this.dependencies.billing.lease(computer)
    const existing = (lease.usage.computerLifecycle as { maintenance?: { kind?: string; token?: string; expiresAt?: number } } | undefined)?.maintenance
    const canReconcile = kind === 'provision' && existing?.kind === 'provision'
      && (existing.expiresAt ?? 0) <= this.now()
    if (existing?.token && (existing.expiresAt ?? 0) <= this.now() && !canReconcile) {
      throw new Error('COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION')
    }
    const claim = await this.dependencies.leases.claimComputerMaintenance?.({
      workspaceId: computer.workspaceId, leaseId: lease.id, kind, token,
      now: this.now(), expiresAt: this.now() + MAINTENANCE_MS, force,
      ...(canReconcile && existing?.token ? { reconcileToken: existing.token } : {}),
    })
    if (!claim) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    return token
  }

  private releaseMaintenance(computer: Computer, token: string) {
    return this.dependencies.leases.releaseComputerMaintenance?.({
      workspaceId: computer.workspaceId, leaseId: `computer:${computer.id}`, token, now: this.now(),
    })
  }

  private requireRuntime(provider: string): SandboxRuntime {
    const runtime = this.dependencies.runtimeFor(provider)
    if (!runtime) throw new Error('COMPUTER_PROVIDER_UNAVAILABLE')
    return runtime
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }
  private cleanupRetryAt(attempts: number) {
    return this.now() + Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1))
  }
  private newId() { return this.dependencies.newId?.() ?? globalThis.crypto.randomUUID() }
  private sleep(ms: number) { return this.dependencies.sleep?.(ms) ?? new Promise<void>((resolve) => setTimeout(resolve, ms)) }
}
