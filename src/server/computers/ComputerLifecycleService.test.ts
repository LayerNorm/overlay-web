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

test('successful provisioning completes the lease to running before returning the ready Computer', async () => {
  const fixture = lifecycleFixture()
  const computer = await fixture.service.provision({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  })
  const lease = await fixture.leases.getSandboxLease({ workspaceId: 'ws-1', leaseId: `computer:${computer.id}` })
  assert.equal(computer.status, 'ready')
  assert.equal(lease?.status, 'running')
  assert.equal(lease?.runtimeStartedAt, now)
  assert.equal(lease?.reservedUntil, now + 2 * 60 * 60_000)
  assert.deepEqual(fixture.sequence.slice(-3), ['transition:session_armed', 'meter:running', 'transition:ready'])
})

test('idle reconciliation pauses a provisioned Computer while retaining its row and disk', async () => {
  const fixture = lifecycleFixture()
  const computer = await fixture.service.provision({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  })
  const leaseId = `computer:${computer.id}`
  fixture.setNow(now + 10 * 60_000 + 1)
  const lease = fixture.leaseRows.get(leaseId)!

  await fixture.service.handleLease(lease, 'idle_check')

  const stoppedComputer = await fixture.repository.get(computer.id)
  assert.equal(stoppedComputer?.status, 'stopped')
  assert.equal(fixture.leaseRows.get(leaseId)?.status, 'paused')
  assert.equal(fixture.instances[0]?.state, 'stopped')
  assert.equal(fixture.instances[0]?.stops, 1)
  assert.equal(fixture.instances[0]?.deletes, 0)
})

test('an owner-claim response lost before requestedAt retries only after its provision claim expires', async () => {
  const fixture = lifecycleFixture({ failAfterLeaseCreateOnce: true })
  const args = { actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user' as const, ownerId: 'user-1', size: 'default' as const }

  await assert.rejects(fixture.service.provision(args), /owner claim response lost/)
  const computer = await fixture.repository.findByOwner('ws-1', 'user', 'user-1')
  assert.ok(computer)
  const leaseId = `computer:${computer.id}`
  const lease = fixture.leaseRows.get(leaseId)!
  assert.equal(lease.usage.requestedAt, undefined)
  assert.equal(fixture.createCalls.length, 0)
  assert.equal((lease.usage.computerLifecycle as { maintenance?: { actorUserId?: string } }).maintenance?.actorUserId, 'user-1')

  await assert.rejects(fixture.service.provision(args), /COMPUTER_ALLOCATION_IN_PROGRESS/)
  fixture.setNow(now + 6 * 60_000 + 1)
  const ready = await fixture.service.provision(args)

  assert.equal(ready.status, 'ready')
  assert.equal(fixture.createCalls.length, 1)
  assert.equal(typeof fixture.leaseRows.get(leaseId)?.usage.requestedAt, 'number')
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

test('ambiguous provisioning replays the exact request within 24 hours and refuses it afterward', async () => {
  const fixture = lifecycleFixture({ failBeforeAllocationOnce: true })
  const args = { actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user' as const, ownerId: 'user-1', size: 'default' as const }
  await assert.rejects(fixture.service.provision(args), /ambiguous create/)
  const computer = await fixture.repository.findByOwner('ws-1', 'user', 'user-1')
  assert.ok(computer)
  const leaseId = `computer:${computer.id}`
  const firstLease = fixture.leaseRows.get(leaseId)!
  const requestedAt = firstLease.usage.requestedAt
  fixture.setNow(now + 7 * 60_000)
  await fixture.service.provision(args)
  assert.equal(fixture.createCalls.length, 2)
  assert.equal(fixture.leaseRows.get(leaseId)?.usage.requestedAt, requestedAt)
  const requestBody = (request: SandboxCreateRequest) =>
    Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'onAllocated'))
  const firstRequest = requestBody(fixture.createCalls[0]!)
  const secondRequest = requestBody(fixture.createCalls[1]!)
  assert.deepEqual(secondRequest, firstRequest)

  const expired = lifecycleFixture({ failBeforeAllocationOnce: true })
  await assert.rejects(expired.service.provision(args), /ambiguous create/)
  expired.setNow(now + 24 * 60 * 60_000 + 1)
  await assert.rejects(expired.service.provision(args), /COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION/)
  assert.equal(expired.createCalls.length, 1)
})

test('ambiguous provisioning recovery rechecks admission with the saved session actor', async () => {
  const fixture = lifecycleFixture({ failBeforeAllocationOnce: true })
  await assert.rejects(fixture.service.provision({
    actorUserId: 'session-user', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'default',
  }), /ambiguous create/)
  const computer = await fixture.repository.findByOwner('ws-1', 'user', 'user-1')
  assert.ok(computer)
  await fixture.repository.update(computer.id, { createdBy: 'computer-creator' })
  fixture.admissionCalls.length = 0
  fixture.setNow(now + 7 * 60_000)
  const lease = fixture.leaseRows.get(`computer:${computer.id}`)!

  const outcome = await fixture.service.handleLease(lease)

  assert.equal(outcome.outcome, 'adopted')
  assert.deepEqual(fixture.admissionCalls.map((call) => call.userId), ['session-user'])
  assert.equal(fixture.reserveCalls.at(-1)?.actorUserId, 'session-user')
  assert.equal(fixture.createCalls.length, 2)
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

test('owner operations retry a temporarily unavailable wake claim', async () => {
  const fixture = lifecycleFixture({ nullWakeClaims: 1 })
  fixture.seedComputer('box-ref-1', 'running')
  let operationCalled = false

  await fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => { operationCalled = true },
  })

  assert.equal(operationCalled, true)
  assert.deepEqual(fixture.sleepCalls, [250])
})

test('a reconnect failure releases its wake claim so the next operation can retry immediately', async () => {
  const fixture = lifecycleFixture({ failReconnectOnce: true })
  const computer = fixture.seedComputer('box-ref-1', 'running')
  const args = {
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user' as const, ownerId: 'user-1',
    operation: async () => 'done',
  }
  await assert.rejects(fixture.service.withOwnerOperation(args), /reconnect failed/)
  const lifecycle = fixture.leaseRows.get(`computer:${computer.id}`)!.usage.computerLifecycle as { maintenance?: unknown }
  assert.equal(lifecycle.maintenance, null)
  assert.equal(await fixture.service.withOwnerOperation(args), 'done')
  assert.equal(fixture.instances[0].stops, 0)
  assert.deepEqual(fixture.sleepCalls, [])
})

for (const kind of ['wake', 'stop', 'idle', 'provision']) {
  test(`owner operations reconcile an expired ${kind} claim before waking the same computer`, async () => {
    const fixture = lifecycleFixture()
    const computer = fixture.seedComputer('box-ref-1', 'running')
    const leaseId = `computer:${computer.id}`
    const lease = fixture.leaseRows.get(leaseId)!
    fixture.leaseRows.set(leaseId, { ...lease, status: 'cleanup_failed', usage: {
      ...lease.usage, computerLifecycle: { maintenance: { kind, token: 'abandoned', expiresAt: now - 1 } },
    } })
    assert.equal(await fixture.service.withOwnerOperation({
      actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
      operation: async () => 'done',
    }), 'done')
    assert.equal(fixture.instances[0].stops, 1)
    assert.equal(fixture.instances[0].resumes, 1)
    assert.equal(fixture.instances[0].deletes, 0)
    assert.equal(fixture.createCalls.length, 0)
    assert.ok(fixture.sequence.indexOf('transition:paused') < fixture.sequence.indexOf('claim:wake'))
    assert.ok(fixture.sequence.indexOf('meter:stopped') < fixture.sequence.indexOf('reserve'))
    assert.equal(fixture.leaseRows.get(leaseId)?.status, 'running')
  })
}

test('failed reconciliation never resumes a computer or bypasses its unsettled usage', async () => {
  const fixture = lifecycleFixture({ meterError: new Error('ledger unavailable') })
  const computer = fixture.seedComputer('box-ref-1', 'running')
  const leaseId = `computer:${computer.id}`
  const lease = fixture.leaseRows.get(leaseId)!
  fixture.leaseRows.set(leaseId, { ...lease, usage: {
    ...lease.usage, computerLifecycle: { maintenance: { kind: 'wake', token: 'abandoned', expiresAt: now - 1 } },
  } })
  await assert.rejects(fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => assert.fail('must not execute'),
  }), /ledger unavailable/)
  assert.equal(fixture.instances[0].resumes, 0)
  assert.equal(fixture.instances[0].deletes, 0)
  assert.equal(fixture.leaseRows.get(leaseId)?.status, 'cleanup_failed')
})

test('an expired delete intent cannot be recovered by an owner operation', async () => {
  const fixture = lifecycleFixture()
  const computer = fixture.seedComputer('box-ref-1', 'running')
  const leaseId = `computer:${computer.id}`
  const lease = fixture.leaseRows.get(leaseId)!
  fixture.leaseRows.set(leaseId, { ...lease, usage: {
    ...lease.usage, computerLifecycle: { maintenance: { kind: 'delete', token: 'delete', expiresAt: now - 1 } },
  } })
  await assert.rejects(fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => assert.fail('must not execute'),
  }), /COMPUTER_MAINTENANCE_REQUIRES_RECONCILIATION/)
  assert.equal(fixture.instances[0].stops, 0)
  assert.equal(fixture.instances[0].resumes, 0)
})

test('owner operations stop retrying wake claims after the bounded wait budget', async () => {
  const fixture = lifecycleFixture({ nullWakeClaims: Number.POSITIVE_INFINITY })
  fixture.seedComputer('box-ref-1', 'running')
  let operationCalled = false

  await assert.rejects(fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => { operationCalled = true },
  }), /COMPUTER_MAINTENANCE_IN_PROGRESS/)

  assert.equal(operationCalled, false)
  assert.equal(fixture.sleepCalls.reduce((total, ms) => total + ms, 0), 20_000)
  assert.ok(fixture.sleepCalls.every((ms) => ms <= 2_000))
})

test('wake final-meters the stopped session and invalidates old evidence before resuming', async () => {
  const fixture = lifecycleFixture()
  const computer = fixture.seedComputer('box-ref-1', 'stopped')
  const leaseId = `computer:${computer.id}`
  const lease = fixture.leaseRows.get(leaseId)!
  fixture.leaseRows.set(leaseId, {
    ...lease, usage: {
      ...lease.usage, lastProviderEvidence: {
        stopped: true, providerReference: 'box-ref-1', observedAt: now - 1, usage: { providerMetrics: {} },
      },
    },
  })
  fixture.instances[0]!.onResume = () => {
    const armed = fixture.leaseRows.get(leaseId)!
    assert.equal(armed.usage.lastProviderEvidence, null)
    assert.equal(armed.usage.stoppedEvidenceInvalidatedAt, now)
  }
  await fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => undefined,
  })
  assert.ok(fixture.sequence.indexOf('meter:stopped') < fixture.sequence.indexOf('reserve'))
  assert.ok(fixture.sequence.indexOf('reserve') < fixture.sequence.indexOf('transition:wake_armed'))
  assert.ok(fixture.sequence.indexOf('transition:wake_armed') < fixture.sequence.indexOf('meter:running'))
})

test('legacy enrollment adopts counters before reserving a wake', async () => {
  const fixture = lifecycleFixture()
  const computer = fixture.seedComputer('box-ref-1', 'running')
  fixture.leaseRows.delete(`computer:${computer.id}`)
  await fixture.service.withOwnerOperation({
    actorUserId: 'user-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
    operation: async () => undefined,
  })
  assert.equal(fixture.meteredUsageAtCall[0], undefined)
  assert.ok(fixture.sequence.indexOf('meter:stopped') < fixture.sequence.indexOf('reserve'))
  assert.equal(fixture.instances[0]!.stops, 1)
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

test('a lost provider delete response retries from stopped evidence and settles the final sample once', async () => {
  const fixture = lifecycleFixture({ loseDeleteResponseAfterSuccess: true })
  const computer = fixture.seedComputer('box-ref-1', 'running')
  const instance = fixture.instances[0]!
  await assert.rejects(fixture.service.stop(computer, 'user-1', true), /delete response lost/)
  assert.equal(await instance.status(), 'deleted')
  assert.equal(fixture.stoppedMeterCalls, 1)
  assert.ok(await fixture.repository.get(computer.id))

  fixture.setNow(now + 6 * 60_000 + 1)
  await fixture.service.stop(computer, 'user-1', true)

  assert.equal(fixture.stoppedMeterCalls, 2)
  assert.equal(fixture.finalSettlementCount, 1)
  assert.equal(instance.deletes, 1)
  assert.equal(fixture.createCalls.length, 0)
  assert.equal(await fixture.repository.get(computer.id), null)
  const lease = await fixture.leases.getSandboxLease({ workspaceId: 'ws-1', leaseId: `computer:${computer.id}` })
  assert.equal(lease?.status, 'released')
})

function lifecycleFixture(options: {
  reserveError?: Error
  meterError?: Error
  failAfterAllocation?: boolean
  failAfterLeaseCreateOnce?: boolean
  failBeforeRequest?: boolean
  failBeforeAllocationOnce?: boolean
  loseDeleteResponseAfterSuccess?: boolean
  nullWakeClaims?: number
  failReconnectOnce?: boolean
  now?: number
} = {}) {
  let currentNow = options.now ?? now
  const computers = new Map<string, Computer>()
  const leaseRows = new Map<string, AgentSandboxLease>()
  const instances: FakeInstance[] = []
  const createCalls: SandboxCreateRequest[] = []
  const sequence: string[] = []
  const meteredUsageAtCall: unknown[] = []
  const reserveCalls: Array<{ computer: Computer; actorUserId: string }> = []
  const admissionCalls: Array<{ workspaceId: string; userId: string; agentId?: string }> = []
  const releaseReservationCalls: string[] = []
  const sleepCalls: number[] = []
  const settledFinalSamples = new Set<string>()
  let stoppedMeterCalls = 0
  let finalSettlementCount = 0
  let lostLeaseCreateResponse = false
  let nullWakeClaims = options.nullWakeClaims ?? 0
  let reconnectFailed = false
  const repository: ComputerRepository = {
    async create(row) { computers.set(row.id, row); return row },
    async createWithLease(row, seed) {
      const existing = [...computers.values()].find((value) => value.workspaceId === row.workspaceId
        && value.ownerType === row.ownerType && value.ownerId === row.ownerId)
      if (existing) {
        if (!leaseRows.has(seed.id)) {
          leaseRows.set(seed.id, { ...seed, id: seed.id, createdAt: seed.now, updatedAt: seed.now })
        }
        return { computer: existing, created: false }
      }
      computers.set(row.id, row)
      const lease: AgentSandboxLease = {
        ...seed, id: seed.id, createdAt: seed.now, updatedAt: seed.now,
      }
      leaseRows.set(seed.id, lease)
      if (options.failAfterLeaseCreateOnce && !lostLeaseCreateResponse) {
        lostLeaseCreateResponse = true
        throw new Error('owner claim response lost')
      }
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
      const lifecycle = lease.usage.computerLifecycle as { maintenance?: { token?: string; kind?: string } } | undefined
      const canContinue = lifecycle?.maintenance?.token === args.maintenanceToken
        && lifecycle.maintenance.kind === 'provision' && ['reserved', 'provisioning'].includes(lease.status)
      const updated = { ...computer, providerRef: args.reference }
      computers.set(updated.id, updated)
      leaseRows.set(args.leaseId, {
        ...lease, providerReference: args.reference,
        usage: { ...lease.usage, meteredProviderReference: args.reference },
      })
      sequence.push('bind')
      return { computer: updated, canContinue }
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
      recoveryProtocol?: 'computer-recovery-v1'
      actorUserId?: string; expectedProviderReference?: string | null
    }) {
      if (args.kind === 'wake' && nullWakeClaims > 0) {
        if (Number.isFinite(nullWakeClaims)) nullWakeClaims -= 1
        return null
      }
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId
        || (args.expectedProviderReference !== undefined && (lease.providerReference ?? null) !== args.expectedProviderReference)) return null
      const usage = lease.usage
      const lifecycle = (usage.computerLifecycle ?? {}) as Record<string, unknown>
      const current = lifecycle.maintenance as { token?: string; expiresAt?: number; kind?: string } | undefined
      if (args.kind === 'stop' && args.force === false) {
        assert.equal(args.recoveryProtocol, 'computer-recovery-v1')
      }
      if (args.reconcileToken && (current?.token !== args.reconcileToken || (current.expiresAt ?? Infinity) > args.now)) return null
      if (args.reconcileToken && args.kind === 'stop' && !args.force) {
        const activity = lifecycle.activityTokens as Record<string, { expiresAt?: number }> | undefined
        if (Object.values(activity ?? {}).some(value => (value.expiresAt ?? 0) > args.now)) return null
      }
      const active = Boolean(current?.token && current.token !== args.token && (current.expiresAt ?? Infinity) > args.now)
      const preempt = args.force && ['stop', 'delete'].includes(args.kind) && current?.kind !== 'delete'
      if (active && !preempt) return null
      if (current?.token && current.token !== args.token && !active && current.token !== args.reconcileToken) return null
      if (current?.kind === 'delete' && args.kind !== 'delete') return null
      leaseRows.set(args.leaseId, {
        ...lease, status: ['stop', 'idle', 'delete'].includes(args.kind) ? 'stopping' : lease.status,
        usage: { ...usage, computerLifecycle: {
          ...lifecycle, maintenance: { kind: args.kind, token: args.token, expiresAt: args.expiresAt, actorUserId: args.actorUserId },
          activityTokens: args.force ? {} : lifecycle.activityTokens ?? {},
        } },
      })
      sequence.push(`claim:${args.kind}`)
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
      workspaceId: string; leaseId: string; allocationKey: string; allocationRecipe: string; maintenanceToken: string; now: number
    }) {
      if (options.failBeforeRequest) return null
      const lease = leaseRows.get(args.leaseId)
      if (!lease || lease.workspaceId !== args.workspaceId) return null
      const lifecycle = lease.usage.computerLifecycle as { maintenance?: { token?: string; kind?: string } } | undefined
      if (lifecycle?.maintenance?.token !== args.maintenanceToken || lifecycle.maintenance.kind !== 'provision') return null
      const usage = lease.usage
      if ((usage.allocationKey && usage.allocationKey !== args.allocationKey)
        || (usage.allocationRecipe && usage.allocationRecipe !== args.allocationRecipe)) return null
      const requestedAt = typeof usage.requestedAt === 'number' ? usage.requestedAt : args.now
      leaseRows.set(args.leaseId, {
        ...lease, status: 'provisioning', usage: {
          ...usage, allocationKey: args.allocationKey, allocationRecipe: args.allocationRecipe, requestedAt,
        },
      })
      sequence.push('prepare')
      return { requestedAt }
    },
    async transitionComputerLifecycle(args: {
      workspaceId: string; computerId: string; leaseId: string; token: string
      transition: 'wake_armed' | 'session_armed' | 'ready' | 'paused' | 'deleted' | 'failed' | 'cancelled'
      expectedProviderReference: string | null; now: number; reservedUntil?: number
      cleanupAfter?: number | null; cleanupAttempts?: number; activityToken?: string; activityUserId?: string
      activityExpiresAt?: number; allocationRetryable?: boolean
    }) {
      const lease = leaseRows.get(args.leaseId)
      const computer = computers.get(args.computerId)
      const lifecycle = lease?.usage.computerLifecycle as Record<string, unknown> | undefined
      const maintenance = lifecycle?.maintenance as { token?: string; kind?: string } | undefined
      if (!lease || !computer || lease.workspaceId !== args.workspaceId || lease.computerId !== args.computerId
        || computer.workspaceId !== args.workspaceId
        || (lease.providerReference ?? null) !== args.expectedProviderReference
        || (computer.providerRef ?? null) !== args.expectedProviderReference
        || maintenance?.token !== args.token) return false
      if (args.transition === 'failed') {
        leaseRows.set(args.leaseId, { ...lease, status: 'cleanup_failed', cleanupAfter: args.cleanupAfter ?? args.now + 60_000 })
      } else if (args.transition === 'wake_armed') {
        leaseRows.set(args.leaseId, {
          ...lease, status: 'reserved', reservedUntil: args.reservedUntil, runtimeStartedAt: args.now,
          usage: { ...lease.usage, lastProviderEvidence: null, stoppedEvidenceInvalidatedAt: args.now },
        })
      } else if (args.transition === 'session_armed') {
        leaseRows.set(args.leaseId, { ...lease, status: 'provisioning', reservedUntil: args.reservedUntil, runtimeStartedAt: args.now })
      } else if (args.transition === 'ready') {
        const activityTokens = { ...((lifecycle?.activityTokens ?? {}) as Record<string, unknown>) }
        if (args.activityToken) activityTokens[args.activityToken] = { userId: args.activityUserId, expiresAt: args.activityExpiresAt }
        leaseRows.set(args.leaseId, {
          ...lease, status: 'running', reservedUntil: args.reservedUntil, runtimeStartedAt: args.now,
          usage: { ...lease.usage, computerLifecycle: { ...lifecycle, maintenance: null, activityTokens } },
        })
        computers.set(computer.id, { ...computer, status: 'ready', lastActiveAt: args.now })
      } else if (args.transition === 'cancelled') {
        leaseRows.set(args.leaseId, {
          ...lease, usage: {
            ...lease.usage, ...(args.allocationRetryable === undefined ? {} : { allocationRetryable: args.allocationRetryable }),
            computerLifecycle: { ...lifecycle, maintenance: null },
          },
        })
      } else if (args.transition === 'deleted') {
        leaseRows.set(args.leaseId, { ...lease, status: 'released', usage: { ...lease.usage, computerLifecycle: { ...lifecycle, maintenance: null } } })
        computers.delete(computer.id)
      } else {
        leaseRows.set(args.leaseId, { ...lease, status: 'paused', reservedUntil: args.now, usage: { ...lease.usage, computerLifecycle: { ...lifecycle, maintenance: null, adoptionPending: false } } })
        computers.set(computer.id, { ...computer, status: 'stopped' })
      }
      sequence.push(`transition:${args.transition}`)
      return true
    },
  } as unknown as ConnectedAgentRepository
  const runtime: SandboxRuntime = {
    provider: 'box',
    capabilities: { desktop: true },
    async create(request) {
      createCalls.push(request)
      sequence.push('create')
      if (options.failBeforeAllocationOnce && createCalls.length === 1) throw new Error('ambiguous create')
      await request.onAllocated?.('box-ref-1')
      if (options.failAfterAllocation) throw new Error('readiness failed')
      const instance = new FakeInstance('box-ref-1')
      instances.push(instance)
      return instance as unknown as SandboxInstance
    },
    async reconnect(reference) {
      if (options.failReconnectOnce && !reconnectFailed) {
        reconnectFailed = true
        throw new Error('reconnect failed')
      }
      const existing = instances.find((instance) => instance.reference === reference)
      if (existing && await existing.status() === 'deleted') throw new Error('404 not found')
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
      sequence.push('reserve')
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
    async meter(computer: Computer, stopped = false) {
      sequence.push(`meter:${stopped ? 'stopped' : 'running'}`)
      if (options.meterError) throw options.meterError
      const leaseId = `computer:${computer.id}`
      const lease = leaseRows.get(leaseId)
      meteredUsageAtCall.push(lease?.usage.meteredUsage)
      if (stopped) {
        stoppedMeterCalls += 1
        if (lease) {
          const evidence = lease.usage.lastProviderEvidence as { usage?: SandboxUsage } | undefined
          const instance = instances.find((value) => value.reference === computer.providerRef)
          const usage = instance ? await instance.usage() : evidence?.usage
          const fingerprint = `${computer.providerRef}:${JSON.stringify(usage)}`
          if (!settledFinalSamples.has(fingerprint)) {
            settledFinalSamples.add(fingerprint)
            finalSettlementCount += 1
          }
          leaseRows.set(leaseId, { ...lease, usage: {
            ...lease.usage, meteredUsage: lease.usage.meteredUsage ?? {},
            meteredProviderReference: computer.providerRef,
            lastProviderEvidence: {
              stopped: true, providerReference: computer.providerRef, observedAt: currentNow, usage,
            },
          } })
        }
      }
      return { applied: true, usage: {} as SandboxUsage }
    },
  }
  let nextId = 0
  const service = new ComputerLifecycleService({
    repository, leases, billing: billing as never, runtimeFor: () => runtime,
    assertCanRun: async (input) => { admissionCalls.push(input) },
    now: () => currentNow, newId: () => `token-${++nextId}`,
    sleep: async (ms) => { sleepCalls.push(ms); currentNow += ms },
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
    const instance = new FakeInstance(
      providerRef, state === 'stopped' ? 'stopped' : 'running', options.loseDeleteResponseAfterSuccess,
    )
    instances.push(instance)
    return computer
  }
  return {
    service, repository, leases, createCalls, reserveCalls, releaseReservationCalls, instances, sequence, sleepCalls,
    seedComputer, leaseRows, meteredUsageAtCall, admissionCalls, setNow: (value: number) => { currentNow = value },
    get stoppedMeterCalls() { return stoppedMeterCalls },
    get finalSettlementCount() { return finalSettlementCount },
  }
}

class FakeInstance {
  resumes = 0
  stops = 0
  deletes = 0
  onResume?: () => void
  constructor(
    readonly reference: string,
    private state: string = 'running',
    private loseDeleteResponseAfterSuccess = false,
  ) {}
  async status() { return this.state }
  async usage(): Promise<SandboxUsage> { return { providerMetrics: { running: this.state === 'running' } } }
  async resume() { this.resumes += 1; this.state = 'running'; this.onResume?.() }
  async stop() { this.stops += 1; this.state = 'stopped' }
  async delete() {
    this.deletes += 1
    this.state = 'deleted'
    if (this.loseDeleteResponseAfterSuccess) {
      this.loseDeleteResponseAfterSuccess = false
      throw new Error('delete response lost')
    }
  }
}
