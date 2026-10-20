import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentSandboxLease, Computer } from '@overlay/workspace-contracts'
import type { SandboxCreateRequest, SandboxInstance, SandboxRuntime, SandboxUsage } from '@overlay/sandbox-runtime'
import type { ConnectedAgentRepository } from '@/server/agents/ConnectedAgentRepository'
import type { ComputerRepository } from './ComputerRepository'
import { ComputerLifecycleService } from './ComputerLifecycleService'

const now = 1_800_000_000_000

test('workspace credit rejection precedes Computer provider allocation', async () => {
  const fixture = lifecycleFixture({ reserveError: new Error('insufficient_credit') })
  await assert.rejects(fixture.service.provision({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  }), /insufficient_credit/)
  assert.equal(fixture.reserveCalls.length, 1)
  assert.equal(fixture.createCalls.length, 0)
})

test('allocation callback binds references before a later readiness failure', async () => {
  const fixture = lifecycleFixture({ failAfterAllocation: true })
  await assert.rejects(fixture.service.provision({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  }), /readiness failed/)
  const computer = await fixture.repository.findByOwner('ws-1', 'user', 'user-1')
  assert.equal(computer?.providerRef, 'box-ref-1')
  const lease = await fixture.leases.getSandboxLease({ workspaceId: 'ws-1', leaseId: `computer:${computer!.id}` })
  assert.equal(lease?.providerReference, 'box-ref-1')
  assert.equal(lease?.usage.meteredProviderReference, 'box-ref-1')
  assert.equal(lease?.status, 'cleanup_failed')
})

test('a definite pre-request failure releases its hold before making allocation retryable', async () => {
  const fixture = lifecycleFixture({ failBeforeRequest: true })
  await assert.rejects(fixture.service.provision({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  }), /COMPUTER_ALLOCATION_RECIPE_CONFLICT/)
  assert.equal(fixture.createCalls.length, 0)
  assert.equal(fixture.releaseReservationCalls.length, 1)
  const computer = await fixture.repository.findByOwner('ws-1', 'user', 'user-1')
  assert.ok(computer)
  const lease = await fixture.leases.getSandboxLease({ workspaceId: 'ws-1', leaseId: `computer:${computer.id}` })
  assert.equal(lease?.usage.runtimeHoldMicros, 0)
  assert.equal(lease?.usage.allocationRetryable, true)
})

test('wake credit rejection never resumes or exposes the Computer', async () => {
  const fixture = lifecycleFixture({ reserveError: new Error('insufficient_credit') })
  const computer = fixture.seedComputer('box-ref-1', 'stopped')
  let operationCalled = false
  await assert.rejects(fixture.service.withOwnerOperation({
    actorUserId: 'user-2', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => { operationCalled = true },
  }), /insufficient_credit/)
  assert.equal(fixture.instances[0].resumes, 0)
  assert.equal(operationCalled, false)
  assert.equal(fixture.reserveCalls[0]?.computer.id, computer.id)
})

test('failed final settlement keeps a stopped Computer for retry instead of deleting its disk', async () => {
  const fixture = lifecycleFixture({ meterError: new Error('ledger unavailable') })
  const computer = fixture.seedComputer('box-ref-1', 'running')
  const instance = fixture.instances[0]
  await assert.rejects(fixture.service.stop(computer, 'user-1'), /ledger unavailable/)
  assert.equal(instance.stops, 1)
  assert.equal(instance.deletes, 0)
  assert.ok(await fixture.repository.get(computer.id))
  const failedLease = await fixture.leases.getSandboxLease({ workspaceId: 'ws-1', leaseId: `computer:${computer.id}` })
  assert.equal(failedLease?.status, 'cleanup_failed')
})

function lifecycleFixture(options: {
  reserveError?: Error
  meterError?: Error
  failAfterAllocation?: boolean
  failBeforeRequest?: boolean
} = {}) {
  const computers = new Map<string, Computer>()
  const leaseRows = new Map<string, AgentSandboxLease>()
  const instances: FakeInstance[] = []
  const createCalls: SandboxCreateRequest[] = []
  const reserveCalls: Array<{ computer: Computer; actorUserId: string }> = []
  const releaseReservationCalls: string[] = []
  const repository: ComputerRepository = {
    async create(row) { computers.set(row.id, row); return row },
    async createWithLease(row, seed) {
      const existing = [...computers.values()].find((value) => value.workspaceId === row.workspaceId
        && value.ownerType === row.ownerType && value.ownerId === row.ownerId)
      if (existing) return { computer: existing, created: false }
      computers.set(row.id, row)
      const lease: AgentSandboxLease = {
        ...seed, id: seed.id, createdAt: seed.now, updatedAt: seed.now,
      }
      leaseRows.set(seed.id, lease)
      return { computer: row, created: true }
    },
    async get(id) { return computers.get(id) ?? null },
    async findByOwner(workspaceId, ownerType, ownerId) {
      return [...computers.values()].find((value) =>
        value.workspaceId === workspaceId && value.ownerType === ownerType && value.ownerId === ownerId) ?? null
    },
    async listByWorkspace(workspaceId) { return [...computers.values()].filter((value) => value.workspaceId === workspaceId) },
    async update(id, patch) {
      const current = computers.get(id)
      if (!current) throw new Error('computer missing')
      const updated = { ...current, ...patch }
      computers.set(id, updated)
      return updated
    },
    async delete(id) { computers.delete(id) },
    async bindProviderReference(args) {
      const computer = computers.get(args.computerId)
      const lease = leaseRows.get(args.leaseId)
      if (!computer || !lease || lease.workspaceId !== args.workspaceId
        || lease.computerId !== computer.id || lease.usage.allocationKey !== args.allocationKey) return null
      const updated = { ...computer, providerRef: args.reference }
      computers.set(updated.id, updated)
      leaseRows.set(args.leaseId, {
        ...lease, providerReference: args.reference,
        usage: { ...lease.usage, meteredProviderReference: args.reference },
      })
      return updated
    },
  }
  const leases = {
    async getSandboxLease(args: { workspaceId: string; leaseId: string }) {
      const lease = leaseRows.get(args.leaseId)
      return lease?.workspaceId === args.workspaceId ? lease : null
    },
    async updateSandboxLease(args: {
      workspaceId: string; leaseId: string; status?: AgentSandboxLease['status']; reservedUntil?: number
      cleanupAfter?: number; nextMeterAt?: number; cleanupAttempts?: number; now: number
    }) {
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId) return null
      const patch: Record<string, unknown> = { ...args }
      delete patch.workspaceId
      delete patch.leaseId
      const now = args.now
      delete patch.now
      const updated = { ...lease, ...patch, updatedAt: now }
      leaseRows.set(args.leaseId, updated)
      return updated
    },
    async patchSandboxLeaseUsage(args: {
      workspaceId: string; leaseId: string; patch: Record<string, unknown>; now: number
    }) {
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId) return null
      const updated = { ...lease, usage: { ...lease.usage, ...args.patch }, updatedAt: args.now }
      leaseRows.set(args.leaseId, updated)
      return updated
    },
    async claimComputerMaintenance(args: {
      workspaceId: string; leaseId: string; kind: 'provision' | 'wake' | 'stop' | 'delete' | 'idle'
      token: string; now: number; expiresAt: number; force?: boolean; reconcileToken?: string
    }) {
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return null
      const usage = lease.usage
      const lifecycle = (usage.computerLifecycle ?? {}) as Record<string, unknown>
      const current = lifecycle.maintenance as { token?: string; expiresAt?: number } | undefined
      if (current?.token && current.token !== args.token
        && ((current.expiresAt ?? Infinity) > args.now || current.token !== args.reconcileToken)) return null
      leaseRows.set(args.leaseId, {
        ...lease, usage: { ...usage, computerLifecycle: {
          ...lifecycle, maintenance: { kind: args.kind, token: args.token, expiresAt: args.expiresAt },
          activityTokens: args.force ? {} : lifecycle.activityTokens ?? {},
        } },
      })
      return { kind: args.kind, token: args.token, expiresAt: args.expiresAt }
    },
    async releaseComputerMaintenance(args: { workspaceId: string; leaseId: string; token: string }) {
      const lease = leaseRows.get(args.leaseId)
      const lifecycle = lease?.usage.computerLifecycle as Record<string, unknown> | undefined
      const current = lifecycle?.maintenance as { token?: string } | undefined
      if (!lease || lease.workspaceId !== args.workspaceId || current?.token !== args.token) return false
      leaseRows.set(args.leaseId, { ...lease, usage: { ...lease.usage, computerLifecycle: { ...lifecycle, maintenance: undefined } } })
      return true
    },
    async claimComputerActivity(args: {
      workspaceId: string; leaseId: string; token: string; userId: string; now: number; expiresAt: number
    }) {
      const lease = leaseRows.get(args.leaseId)
      const lifecycle = lease?.usage.computerLifecycle as Record<string, unknown> | undefined
      if (!lease || lease.workspaceId !== args.workspaceId || lifecycle?.maintenance) return null
      const activityTokens = (lifecycle?.activityTokens ?? {}) as Record<string, unknown>
      leaseRows.set(args.leaseId, { ...lease, usage: { ...lease.usage, computerLifecycle: {
        ...lifecycle, activityTokens: { ...activityTokens, [args.token]: { userId: args.userId, expiresAt: args.expiresAt } },
      } } })
      return { token: args.token, expiresAt: args.expiresAt }
    },
    async releaseComputerActivity(args: { workspaceId: string; leaseId: string; token: string }) {
      const lease = leaseRows.get(args.leaseId)
      const lifecycle = lease?.usage.computerLifecycle as Record<string, unknown> | undefined
      const tokens = { ...((lifecycle?.activityTokens ?? {}) as Record<string, unknown>) }
      delete tokens[args.token]
      if (lease) leaseRows.set(args.leaseId, { ...lease, usage: { ...lease.usage, computerLifecycle: { ...lifecycle, activityTokens: tokens } } })
      return Boolean(lease)
    },
    async prepareComputerAllocation(args: {
      workspaceId: string; leaseId: string; allocationKey: string; allocationRecipe: string; now: number
    }) {
      if (options.failBeforeRequest) return null
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId) return null
      const usage = lease.usage
      if ((usage.allocationKey && usage.allocationKey !== args.allocationKey)
        || (usage.allocationRecipe && usage.allocationRecipe !== args.allocationRecipe)) return null
      const requestedAt = typeof usage.requestedAt === 'number' ? usage.requestedAt : args.now
      leaseRows.set(args.leaseId, { ...lease, usage: { ...usage, allocationKey: args.allocationKey, allocationRecipe: args.allocationRecipe, requestedAt } })
      return { requestedAt }
    },
  } as unknown as ConnectedAgentRepository
  const runtime: SandboxRuntime = {
    provider: 'box',
    capabilities: { desktop: true },
    async create(request) {
      createCalls.push(request)
      await request.onAllocated?.('box-ref-1')
      if (options.failAfterAllocation) throw new Error('readiness failed')
      const instance = new FakeInstance('box-ref-1')
      instances.push(instance)
      return instance as unknown as SandboxInstance
    },
    async reconnect(reference) {
      const existing = instances.find((instance) => instance.reference === reference)
      if (existing) return existing as unknown as SandboxInstance
      const instance = new FakeInstance(reference)
      instances.push(instance)
      return instance as unknown as SandboxInstance
    },
    async restore() { throw new Error('not implemented') },
    async deleteSnapshot() {},
  }
  const billing = {
    async lease(computer: Computer) {
      const lease = leaseRows.get(`computer:${computer.id}`)
      if (!lease) throw new Error('lease missing')
      return lease
    },
    async reserve(computer: Computer, actorUserId: string) {
      reserveCalls.push({ computer, actorUserId })
      if (options.reserveError) throw options.reserveError
      const leaseId = `computer:${computer.id}`
      const lease = leaseRows.get(leaseId)
      if (lease) leaseRows.set(leaseId, { ...lease, usage: {
        ...lease.usage, runtimeHoldMicros: 50_000, runtimeHoldPayer: {
          scope: 'workspace', workspaceId: computer.workspaceId, billingAccountId: 'billing-1',
          userId: actorUserId, spendSubjectKind: 'member', spendSubjectId: actorUserId,
        },
      } })
    },
    async releaseReservation(computer: Computer) {
      releaseReservationCalls.push(computer.id)
      const leaseId = `computer:${computer.id}`
      const lease = leaseRows.get(leaseId)
      if (lease) leaseRows.set(leaseId, { ...lease, usage: { ...lease.usage, runtimeHoldMicros: 0 } })
    },
    async meter() {
      if (options.meterError) throw options.meterError
      return { applied: true, usage: {} as SandboxUsage }
    },
  }
  let nextId = 0
  const service = new ComputerLifecycleService({
    repository, leases, billing: billing as never, runtimeFor: () => runtime,
    now: () => now, newId: () => `token-${++nextId}`, sleep: async () => undefined,
  })
  const seedComputer = (providerRef: string, state: string) => {
    const computer: Computer = {
      id: 'computer-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
      provider: 'box', providerRef, size: 'default', status: state as Computer['status'],
      name: null, createdBy: 'user-1', createdAt: now, updatedAt: now, lastActiveAt: now,
    }
    computers.set(computer.id, computer)
    leaseRows.set(`computer:${computer.id}`, {
      id: `computer:${computer.id}`, workspaceId: computer.workspaceId, computerId: computer.id,
      provider: computer.provider, providerReference: providerRef,
      status: state === 'stopped' ? 'paused' : 'running', reservedUntil: now + 60_000,
      usage: { meteredUsage: {}, meterVersion: 0 }, cleanupAttempts: 0, createdAt: now, updatedAt: now,
    })
    const instance = new FakeInstance(providerRef, state === 'stopped' ? 'stopped' : 'running')
    instances.push(instance)
    return computer
  }
  return { service, repository, leases, createCalls, reserveCalls, releaseReservationCalls, instances, seedComputer }
}

class FakeInstance {
  resumes = 0
  stops = 0
  deletes = 0
  constructor(readonly reference: string, private state: string = 'running') {}
  async status() { return this.state }
  async usage(): Promise<SandboxUsage> { return { providerMetrics: { running: this.state === 'running' } } }
  async resume() { this.resumes += 1; this.state = 'running' }
  async stop() { this.stops += 1; this.state = 'stopped' }
  async delete() { this.deletes += 1; this.state = 'deleted' }
}
