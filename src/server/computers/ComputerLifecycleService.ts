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
  adoptLegacyComputer,
  createComputerRecipe,
  handleComputerLease,
  hasMatchingStoppedEvidence,
  isMissingSandboxError,
} from './ComputerLifecycleHelpers'
import { ComputerBilling } from './ComputerBilling'
import { claimComputerMaintenanceWithRetry } from './ComputerMaintenanceClaim'
import type { ComputerLeaseSeed, ComputerRepository } from './ComputerRepository'

const SESSION_MS = 2 * 60 * 60_000
const MAINTENANCE_MS = 6 * 60_000
const ACTIVITY_GRACE_MS = 60_000

type ComputerMaintenance = { kind?: string; token?: string; expiresAt?: number }

export class ComputerLifecycleService {
  constructor(private readonly dependencies: {
    repository: ComputerRepository
    leases: ConnectedAgentRepository
    billing: ComputerBilling
    runtimeFor(provider: string): SandboxRuntime | undefined
    assertCanRun(input: { workspaceId: string; userId: string; agentId?: string }): Promise<void>
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
    const token = this.newId()
    const claim = await this.claimProvision(args, token)
    if (!claim.allocate) {
      const lease = await this.ensureEnrolled(claim.computer)
      await this.adoptLegacy(claim.computer, lease)
      return await this.dependencies.repository.get(claim.computer.id) ?? claim.computer
    }
    await this.requireMaintenance(claim.computer, 'provision', token, false, args.actorUserId)
    return await this.allocateComputer({
      computer: claim.computer, leaseId: claim.leaseId, actorUserId: args.actorUserId, token,
    })
  }

  private async claimProvision(args: {
    actorUserId: string
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    size: Computer['size']
    name?: string
  }, token: string): Promise<{ computer: Computer; leaseId: string; allocate: boolean }> {
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
      usage: existing?.providerRef
        ? { computerLifecycle: { adoptionPending: true } }
        : {
          meteredUsage: {}, meterVersion: 0, allocationProtocol: 'computer-v1',
          computerLifecycle: {
            maintenance: {
              kind: 'provision', token, expiresAt: now + MAINTENANCE_MS, actorUserId: args.actorUserId,
            },
          },
        },
      cleanupAttempts: 0, nextMeterAt: now, now,
    }
    const claimed = await this.dependencies.repository.createWithLease(computer, lease)
    if (existing?.providerRef) {
      if (existing.status === 'error') throw new Error('COMPUTER_CLEANUP_REQUIRES_RECONCILIATION')
      return { computer: claimed.computer, leaseId: lease.id, allocate: false }
    }
    if (existing) await this.assertProvisionRetryable(existing, token)
    else if (!claimed.created) {
      if (claimed.computer.providerRef) {
        return { computer: claimed.computer, leaseId: lease.id, allocate: false }
      }
      throw new Error('COMPUTER_ALLOCATION_IN_PROGRESS')
    }
    return { computer: claimed.computer, leaseId: lease.id, allocate: true }
  }

  private async assertProvisionRetryable(computer: Computer, token: string) {
    const lease = await this.dependencies.billing.lease(computer)
    const pending = lease.usage.computerLifecycle as { maintenance?: ComputerMaintenance } | undefined
    if (pending?.maintenance?.token && ['stop', 'idle', 'delete', 'wake'].includes(pending.maintenance.kind ?? '')) {
      throw new Error('COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION')
    }
    if (lease.usage.allocationProtocol !== 'computer-v1' && typeof lease.usage.requestedAt !== 'number') {
      throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
    }
    if (typeof lease.usage.requestedAt !== 'number' && lease.usage.allocationRetryable !== true) {
      const maintenance = pending?.maintenance
      const isCurrentClaim = maintenance?.token === token && maintenance.kind === 'provision'
      const expiredProvisionClaim = maintenance?.token && maintenance.kind === 'provision'
        && (maintenance.expiresAt ?? 0) <= this.now()
      if (!isCurrentClaim && maintenance?.token && !expiredProvisionClaim) {
        throw new Error('COMPUTER_ALLOCATION_IN_PROGRESS')
      }
      if (maintenance && !maintenance.token) throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
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
  }): Promise<Computer> {
    const { computer, leaseId, actorUserId, token } = args
    try {
      await this.dependencies.billing.reserve(computer, actorUserId)
      const runtime = this.requireRuntime('box')
      const allocation = await this.prepareAllocation(computer, leaseId, token)
      const instance = await runtime.create({
        ...JSON.parse(allocation.recipe) as ReturnType<typeof createComputerRecipe>,
        allocationKey: allocation.allocationKey,
        onAllocated: async (reference) => {
          const bound = await this.dependencies.repository.bindProviderReference({
            computerId: computer.id, workspaceId: computer.workspaceId,
            leaseId, reference, allocationKey: allocation.allocationKey, maintenanceToken: token,
          })
          if (!bound || !bound.canContinue) throw new Error('COMPUTER_ALLOCATION_CANCELLED')
        },
      })
      const reservedUntil = this.now() + SESSION_MS
      const armed = await this.dependencies.leases.transitionComputerLifecycle?.({
        workspaceId: computer.workspaceId, computerId: computer.id, leaseId, token,
        transition: 'session_armed', expectedProviderReference: instance.reference,
        reservedUntil, now: this.now(),
      })
      if (!armed) throw new Error('COMPUTER_PROVISION_COMPLETION_STALE')
      await this.dependencies.billing.meter({ ...computer, providerRef: instance.reference }, false)
      const ready = await this.dependencies.leases.transitionComputerLifecycle?.({
        workspaceId: computer.workspaceId, computerId: computer.id, leaseId, token,
        transition: 'ready', expectedProviderReference: instance.reference,
        reservedUntil, now: this.now(),
      })
      if (!ready) throw new Error('COMPUTER_PROVISION_COMPLETION_STALE')
      const current = await this.dependencies.repository.get(computer.id)
      if (!current) throw new Error('COMPUTER_PROVISION_COMPLETION_STALE')
      return current
    } catch (error) {
      await this.recordProvisionFailure(computer, leaseId, token)
      throw error
    }
  }

  private async prepareAllocation(computer: Computer, leaseId: string, token: string) {
    const allocationKey = `computer:${computer.id}`
    const storedLease = await this.dependencies.billing.lease(computer)
    const recipe = typeof storedLease.usage.allocationRecipe === 'string'
      ? storedLease.usage.allocationRecipe
      : JSON.stringify(createComputerRecipe(computer, SESSION_MS))
    const prepared = await this.dependencies.leases.prepareComputerAllocation?.({
      workspaceId: computer.workspaceId, leaseId,
      allocationKey, allocationRecipe: recipe, maintenanceToken: token, now: this.now(),
    })
    if (!prepared) throw new Error('COMPUTER_ALLOCATION_RECIPE_CONFLICT')
    if (this.now() - prepared.requestedAt > 24 * 60 * 60_000) {
      throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
    }
    return { allocationKey, recipe }
  }

  private async recordProvisionFailure(computer: Computer, leaseId: string, token: string) {
    const lease = await this.dependencies.billing.lease(computer).catch((_error) => null)
    if (!lease) return
    const usage = lease.usage ?? {}
    const allocationStarted = typeof usage.requestedAt === 'number'
      || typeof usage.allocationKey === 'string' || typeof usage.allocationRecipe === 'string'
      || typeof usage.meteredProviderReference === 'string'
      || Boolean(computer.providerRef || lease.providerReference)
    if (!allocationStarted) {
      try {
        await this.dependencies.billing.releaseReservation(computer)
      } catch (error) {
        await this.markProvisionCleanupFailed(computer, leaseId, token, null)
        throw error
      }
      await this.dependencies.leases.transitionComputerLifecycle?.({
        workspaceId: computer.workspaceId, computerId: computer.id, leaseId, token,
        transition: 'cancelled', expectedProviderReference: null,
        allocationRetryable: true, now: this.now(),
      })
      return
    }
    await this.markProvisionCleanupFailed(computer, leaseId, token, lease.providerReference ?? computer.providerRef)
  }

  private async markProvisionCleanupFailed(computer: Computer, leaseId: string, token: string, reference?: string | null) {
    const lease = await this.dependencies.billing.lease(computer).catch((_error) => null)
    if (!lease) return
    const attempts = lease.cleanupAttempts + 1
    const retryAt = this.cleanupRetryAt(attempts)
    await this.dependencies.leases.transitionComputerLifecycle?.({
      workspaceId: computer.workspaceId, computerId: computer.id, leaseId, token,
      transition: 'failed', expectedProviderReference: reference ?? null,
      cleanupAfter: retryAt, cleanupAttempts: attempts, now: this.now(),
    })
  }

  private async ensureEnrolled(computer: Computer): Promise<AgentSandboxLease> {
    const now = this.now()
    await this.dependencies.repository.createWithLease(computer, {
      id: `computer:${computer.id}`, workspaceId: computer.workspaceId, computerId: computer.id,
      provider: computer.provider, providerReference: computer.providerRef ?? undefined,
      status: computer.providerRef ? 'paused' : 'reserved', reservedUntil: now,
      usage: { computerLifecycle: { adoptionPending: true } }, cleanupAttempts: 0,
      nextMeterAt: now, now,
    })
    return await this.dependencies.billing.lease(computer)
  }

  private async adoptLegacy(computer: Computer, lease: AgentSandboxLease): Promise<void> {
    await adoptLegacyComputer(computer, lease, {
      leases: this.dependencies.leases,
      billing: this.dependencies.billing,
      maintenanceMs: MAINTENANCE_MS,
      newId: () => this.newId(),
      now: () => this.now(),
      cleanupRetryAt: (attempts) => this.cleanupRetryAt(attempts),
      requireRuntime: (provider) => this.requireRuntime(provider),
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
    let computer = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
    if (!computer) throw new Error('COMPUTER_UNAVAILABLE')
    let lease = await this.ensureEnrolled(computer)
    await this.adoptLegacy(computer, lease)
    computer = await this.dependencies.repository.get(computer.id) ?? computer
    lease = await this.dependencies.billing.lease(computer)
    if (!computer.providerRef) throw new Error('COMPUTER_UNAVAILABLE')
    const wakeToken = await this.requireMaintenance(computer, 'wake', this.newId(), false, args.actorUserId, true)
    const runtime = this.requireRuntime(computer.provider)
    const instance = await runtime.reconnect(computer.providerRef, { resume: false })
    const activityToken = this.newId()
    const actionDeadline = Math.min(10 * 60_000, Math.max(1, args.actionDeadlineMs ?? 2 * 60_000))
    const activityExpiresAt = this.now() + actionDeadline + ACTIVITY_GRACE_MS
    const reservedUntil = this.now() + SESSION_MS
    let wakeArmed = false
    let resumeMayHaveOccurred = false
    try {
      const status = await instance.status()
      if (status === 'stopped' || status === 'archived') {
        const stoppedUsage = await instance.usage()
        await this.dependencies.billing.meter(computer, true)
        await this.dependencies.billing.reserve(computer, args.actorUserId, stoppedUsage)
        const armed = await this.dependencies.leases.transitionComputerLifecycle?.({
          workspaceId: computer.workspaceId, computerId: computer.id, leaseId: lease.id, token: wakeToken,
          transition: 'wake_armed', expectedProviderReference: computer.providerRef,
          reservedUntil, now: this.now(),
        })
        if (!armed) throw new Error('COMPUTER_WAKE_COMPLETION_STALE')
        wakeArmed = true
        resumeMayHaveOccurred = true
        await instance.resume()
        await this.dependencies.billing.meter(computer)
      } else if (!['running', 'ready', 'idle'].includes(status)) {
        throw new Error('COMPUTER_PROVIDER_UNAVAILABLE')
      } else {
        await this.dependencies.billing.meter(computer)
      }
      const ready = await this.dependencies.leases.transitionComputerLifecycle?.({
        workspaceId: computer.workspaceId, computerId: computer.id, leaseId: lease.id, token: wakeToken,
        transition: 'ready', expectedProviderReference: computer.providerRef,
        reservedUntil, activityToken, activityUserId: args.actorUserId, activityExpiresAt, now: this.now(),
      })
      if (!ready) throw new Error('COMPUTER_WAKE_COMPLETION_STALE')
      computer = await this.dependencies.repository.get(computer.id) ?? computer
      return await args.operation(computer, instance)
    } catch (error) {
      if (wakeArmed || resumeMayHaveOccurred) {
        await this.dependencies.leases.transitionComputerLifecycle?.({
          workspaceId: computer.workspaceId, computerId: computer.id, leaseId: lease.id, token: wakeToken,
          transition: 'failed', expectedProviderReference: computer.providerRef,
          cleanupAfter: this.cleanupRetryAt(lease.cleanupAttempts + 1),
          cleanupAttempts: lease.cleanupAttempts + 1, now: this.now(),
        })
      } else {
        await this.dependencies.leases.transitionComputerLifecycle?.({
          workspaceId: computer.workspaceId, computerId: computer.id, leaseId: lease.id, token: wakeToken,
          transition: 'cancelled', expectedProviderReference: computer.providerRef, now: this.now(),
        })
      }
      throw error
    } finally {
      await this.dependencies.leases.releaseComputerActivity?.({
        workspaceId: computer.workspaceId, leaseId: lease.id, token: activityToken, now: this.now(),
      }).catch((_error) => undefined)
    }
  }

  async handleLease(lease: AgentSandboxLease, reason?: string) {
    return await handleComputerLease(lease, reason, {
      repository: this.dependencies.repository,
      leases: this.dependencies.leases,
      billing: this.dependencies.billing,
      assertCanRun: this.dependencies.assertCanRun,
      now: () => this.now(),
      stop: (...args) => this.stop(...args),
      provision: (args) => this.provision(args),
    })
  }

  async stop(computer: Computer, actorUserId: string, explicitDelete = false, idle = false): Promise<void> {
    const enrolledLease = await this.ensureEnrolled(computer)
    await this.adoptLegacy(computer, enrolledLease)
    computer = await this.dependencies.repository.get(computer.id) ?? computer
    const lease = await this.dependencies.billing.lease(computer)
    const pending = lease.usage.computerLifecycle as { maintenance?: { kind?: string } } | undefined
    const shouldDelete = explicitDelete || pending?.maintenance?.kind === 'delete'
    await this.maintenance(computer, shouldDelete ? 'delete' : idle ? 'idle' : 'stop', async (current, instance, token) => {
      const lease = await this.dependencies.billing.lease(current)
      let finalMeter = false
      if (instance) {
        const initialStatus = await instance.status()
        if (!['stopped', 'archived', 'deleted'].includes(initialStatus)) {
          await instance.stop()
          const status = await instance.status()
          if (!['stopped', 'archived', 'deleted'].includes(status)) throw new Error('COMPUTER_STOP_NOT_CONFIRMED')
        }
        finalMeter = true
      } else {
        const usage = lease.usage ?? {}
        const allocationIntent = typeof usage.requestedAt === 'number'
          || typeof usage.allocationKey === 'string' || typeof usage.allocationRecipe === 'string'
        if (lease.providerReference || current.providerRef || allocationIntent) {
          if (!hasMatchingStoppedEvidence(current, usage, lease.providerReference)) {
            throw new Error('COMPUTER_STOP_EVIDENCE_MISSING')
          }
          finalMeter = true
        } else {
          await this.dependencies.billing.releaseReservation(current)
        }
      }
      if (finalMeter) await this.dependencies.billing.meter(current, true)
      if (shouldDelete) {
        if (instance) await instance.delete()
        const completed = await this.dependencies.leases.transitionComputerLifecycle?.({
          workspaceId: current.workspaceId, computerId: current.id, leaseId: `computer:${current.id}`,
          token, transition: 'deleted',
          expectedProviderReference: current.providerRef, now: this.now(),
        })
        if (!completed) throw new Error('COMPUTER_DELETE_COMPLETION_STALE')
      } else {
        const completed = await this.dependencies.leases.transitionComputerLifecycle?.({
          workspaceId: current.workspaceId, computerId: current.id, leaseId: `computer:${current.id}`,
          token, transition: 'paused',
          expectedProviderReference: current.providerRef, now: this.now(),
        })
        if (!completed) throw new Error('COMPUTER_STOP_COMPLETION_STALE')
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
    operation: (computer: Computer, instance: SandboxInstance | null, token: string) => Promise<void>,
    actorUserId: string,
  ) {
    const lease = await this.dependencies.billing.lease(computer)
    const existing = (lease.usage.computerLifecycle as { maintenance?: { kind?: string; token?: string; expiresAt?: number } } | undefined)?.maintenance
    const token = this.newId()
    const claimedKind = existing?.kind === 'delete' ? 'delete' : kind
    const claim = await this.dependencies.leases.claimComputerMaintenance?.({
      workspaceId: computer.workspaceId, leaseId: lease.id, kind: claimedKind, token, now: this.now(),
      expiresAt: this.now() + MAINTENANCE_MS, force: kind !== 'idle',
      actorUserId, expectedProviderReference: computer.providerRef,
      ...(kind === 'idle' ? { idleBefore: this.now() - 10 * 60_000 } : {}),
      ...(kind === 'idle' ? { ownerType: computer.ownerType, ownerId: computer.ownerId } : {}),
      ...(existing?.token && (existing.expiresAt ?? 0) <= this.now() ? { reconcileToken: existing.token } : {}),
    })
    if (!claim) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    try {
      let instance: SandboxInstance | null = null
      try {
        instance = computer.providerRef
          ? await this.requireRuntime(computer.provider).reconnect(computer.providerRef, { resume: false })
          : null
      } catch (error) {
        if (!isMissingSandboxError(error)) throw error
      }
      await operation(computer, instance, token)
    } catch (error) {
      await this.dependencies.leases.transitionComputerLifecycle?.({
        workspaceId: computer.workspaceId, computerId: computer.id, leaseId: lease.id, token,
        transition: 'failed', expectedProviderReference: computer.providerRef,
        cleanupAttempts: lease.cleanupAttempts + 1, cleanupAfter: this.cleanupRetryAt(lease.cleanupAttempts + 1),
        now: this.now(),
      })
      throw error
    }
  }


  private async requireMaintenance(
    computer: Computer,
    kind: 'provision' | 'wake',
    token: string,
    force: boolean,
    actorUserId?: string,
    retryUnavailable = false,
  ): Promise<string> {
    const lease = await this.dependencies.billing.lease(computer)
    const existing = (lease.usage.computerLifecycle as { maintenance?: { kind?: string; token?: string; expiresAt?: number } } | undefined)?.maintenance
    const canReconcile = kind === 'provision' && existing?.kind === 'provision'
      && (existing.expiresAt ?? 0) <= this.now()
    if (existing?.token && (existing.expiresAt ?? 0) <= this.now() && !canReconcile) {
      throw new Error('COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION')
    }
    if (!this.dependencies.leases.claimComputerMaintenance) {
      throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    }
    await claimComputerMaintenanceWithRetry(
      () => this.dependencies.leases.claimComputerMaintenance!({
        workspaceId: computer.workspaceId, leaseId: lease.id, kind, token,
        now: this.now(), expiresAt: this.now() + MAINTENANCE_MS, force,
        actorUserId, expectedProviderReference: computer.providerRef,
        ...(canReconcile && existing?.token ? { reconcileToken: existing.token } : {}),
      }),
      {
        retryUnavailable,
        now: () => this.now(),
        sleep: (ms) => this.sleep(ms),
      },
    )
    return token
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
