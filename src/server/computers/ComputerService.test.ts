import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import type { Computer } from '@overlay/workspace-contracts'
import { ComputerService, ComputerServiceError } from './ComputerService'
import type { ComputerRepository } from './ComputerRepository'
import type { ComputerLifecycleService } from './ComputerLifecycleService'

const member = { workspaceId: 'ws-1', userId: 'user-1', principalId: 'principal-1', workspaceRole: 'member' as const }
const otherMember = { workspaceId: 'ws-1', userId: 'user-2', principalId: 'principal-2', workspaceRole: 'member' as const }
const owner = { workspaceId: 'ws-1', userId: 'user-9', principalId: 'principal-9', workspaceRole: 'owner' as const }

class MemoryRepository implements ComputerRepository {
  rows = new Map<string, Computer>()
  async create(row: Computer) {
    const existing = await this.findByOwner(row.workspaceId, row.ownerType, row.ownerId)
    if (existing) return existing
    this.rows.set(row.id, { ...row })
    return row
  }
  async createWithLease(row: Computer) {
    const computer = await this.create(row)
    return { computer, created: computer.id === row.id }
  }
  async bindProviderReference() { return null }
  async get(id: string) { return this.rows.get(id) ?? null }
  async findByOwner(workspaceId: string, ownerType: string, ownerId: string) {
    return [...this.rows.values()].find((row) =>
      row.workspaceId === workspaceId && row.ownerType === ownerType && row.ownerId === ownerId) ?? null
  }
  async listByWorkspace(workspaceId: string) {
    return [...this.rows.values()].filter((row) => row.workspaceId === workspaceId)
  }
  async update(id: string, patch: Partial<Computer>) {
    const row = { ...this.rows.get(id)!, ...patch }
    this.rows.set(id, row)
    return row
  }
  async takeControl(id: string, userId: string, controlTakenAt: number) {
    const row = this.rows.get(id)
    if (!row || row.status !== 'ready') return null
    return await this.update(id, { controlledByUserId: userId, controlTakenAt })
  }
  async releaseControl(id: string, now: number) {
    if (!this.rows.has(id)) return null
    return await this.update(id, {
      controlledByUserId: undefined,
      controlTakenAt: undefined,
      updatedAt: now,
    })
  }
  async delete(id: string) { this.rows.delete(id) }
}

function service(overrides: {
  repository?: MemoryRepository
  agents?: Record<string, { visibility: 'workspace' | 'creator'; createdByPrincipalId: string }>
  assertCanRun?: () => Promise<void>
} = {}) {
  const repository = overrides.repository ?? new MemoryRepository()
  const agents = overrides.agents ?? {}
  const calls: string[] = []
  let nextId = 0
  const lifecycle: Pick<ComputerLifecycleService, 'provision' | 'openDesktop' | 'stop' | 'withOwnerOperation'> = {
    async provision(args) {
      calls.push('provision')
      const existing = await repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
      if (existing) return existing
      return await repository.create({
        id: `computer-${++nextId}`, workspaceId: args.workspaceId, ownerType: args.ownerType, ownerId: args.ownerId,
        provider: 'box', providerRef: 'provider-ref', size: args.size, status: 'ready',
        name: args.name ?? null, createdBy: args.actorUserId, createdAt: 1, updatedAt: 1, lastActiveAt: 1,
      })
    },
    async openDesktop(computer, actorUserId, mode) {
      calls.push(`openDesktop:${computer.id}:${actorUserId}:${mode ?? 'default'}`)
      return { ready: true, url: 'https://stream.example/t', mode: mode ?? 'webrtc' }
    },
    async stop(computer, actorUserId, explicitDelete) {
      calls.push(`${explicitDelete ? 'delete' : 'stop'}:${computer.id}:${actorUserId}`)
      if (explicitDelete) await repository.delete(computer.id)
      else await repository.update(computer.id, { status: 'stopped' })
    },
    async withOwnerOperation(args) {
      calls.push(`operation:${args.ownerId}:${args.actorUserId}`)
      const computer = await repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
      if (!computer) throw new Error('computer missing')
      const instance = { reference: computer.providerRef ?? 'provider-ref' } as SandboxInstance
      return await args.operation(computer, instance)
    },
  }
  const svc = new ComputerService({
    repository,
    assertCanRun: overrides.assertCanRun ?? (async () => {}),
    agentOwner: async (_workspaceId, agentId) => agents[agentId] ?? null,
    lifecycle,
  })
  return { svc, repository, calls }
}

test('provision delegates to the lifecycle coordinator after access and admission checks', async () => {
  const { svc, calls } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'small' })
  assert.equal(computer.status, 'ready')
  assert.deepEqual(calls, ['provision'])
})

test('start and desktop operations use lifecycle delegation', async () => {
  const { svc, calls } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  await svc.start({ actor: member, computerId: computer.id })
  const ticket = await svc.openDesktop({ actor: member, computerId: computer.id, mode: 'vnc' })
  assert.equal(ticket.ready, true)
  assert.deepEqual(calls, ['provision', 'operation:user-1:user-1', `openDesktop:${computer.id}:user-1:vnc`])
})

test('computer control can be taken and released by an authorized workspace member', async () => {
  const { svc, repository } = service({
    agents: { agent_1: { visibility: 'workspace', createdByPrincipalId: 'principal-1' } },
  })
  const computer = await repository.create({
    id: 'control-computer', workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent_1', provider: 'box',
    providerRef: 'provider-ref', size: 'default', status: 'ready', name: null, createdBy: 'user-1',
    createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  const taken = await svc.takeControl({ actor: member, workspaceId: 'ws-1', computerId: computer.id })
  assert.equal(taken.controlledByUserId, member.userId)
  assert.equal(typeof taken.controlTakenAt, 'number')
  const released = await svc.releaseControl({ actor: otherMember, workspaceId: 'ws-1', computerId: computer.id })
  assert.equal(released.controlledByUserId, undefined)
  assert.equal(released.controlTakenAt, undefined)
})

test('computer control can only be taken while ready', async () => {
  const { svc, repository } = service()
  const computer = await repository.create({
    id: 'stopped-computer', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', provider: 'box',
    providerRef: 'provider-ref', size: 'default', status: 'stopped', name: null, createdBy: 'user-1',
    createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  await assert.rejects(
    svc.takeControl({ actor: member, workspaceId: 'ws-1', computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'not_ready',
  )
})

test('computer control cannot be taken from another workspace', async () => {
  const { svc, repository } = service()
  const computer = await repository.create({
    id: 'other-workspace-computer', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', provider: 'box',
    providerRef: 'provider-ref', size: 'default', status: 'ready', name: null, createdBy: 'user-1',
    createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  await assert.rejects(
    svc.takeControl({
      actor: { ...member, workspaceId: 'ws-2' },
      workspaceId: 'ws-2',
      computerId: computer.id,
    }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
})

test('stop and destroy delegate cleanup without requiring paid admission', async () => {
  const { svc, repository, calls } = service({ assertCanRun: async () => { throw new Error('downgraded') } })
  const computer = await repository.create({
    id: 'existing', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', provider: 'box',
    providerRef: 'provider-ref', size: 'default', status: 'ready', name: null, createdBy: 'user-1',
    createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  await svc.stop({ actor: member, computerId: computer.id })
  assert.equal((await repository.get(computer.id))?.status, 'stopped')
  await svc.destroy({ actor: member, computerId: computer.id })
  assert.equal(await repository.get(computer.id), null)
  assert.deepEqual(calls, [`stop:${computer.id}:user-1`, `delete:${computer.id}:user-1`])
})

test('paid admission rejection happens before lifecycle access', async () => {
  const { svc, calls } = service({ assertCanRun: async () => { throw new ComputerServiceError('paid_plan_required', 'paid required', 403) } })
  await assert.rejects(
    svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    /paid required/,
  )
  assert.deepEqual(calls, [])
})

test('creator-only agent access remains restricted to its creator principal', async () => {
  const { svc, repository, calls } = service({
    agents: { 'agent-private': { visibility: 'creator', createdByPrincipalId: 'principal-1' } },
  })
  await repository.create({
    id: 'private-computer', workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-private',
    provider: 'box', providerRef: 'provider-ref', size: 'default', status: 'ready', name: null,
    createdBy: 'user-1', createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  await assert.rejects(svc.getForActor({ actor: otherMember, computerId: 'private-computer' }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden')
  assert.equal((await svc.getForActor({ actor: member, computerId: 'private-computer' })).id, 'private-computer')
  assert.deepEqual(calls, [])
})

test('workspace and owner checks remain ahead of lifecycle actions', async () => {
  const { svc, repository, calls } = service()
  const computer = await repository.create({
    id: 'owned', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', provider: 'box',
    providerRef: 'provider-ref', size: 'default', status: 'ready', name: null, createdBy: 'user-1',
    createdAt: 1, updatedAt: 1, lastActiveAt: 1,
  })
  await assert.rejects(svc.start({ actor: { ...owner, workspaceId: 'ws-other' }, computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden')
  await assert.rejects(svc.destroy({ actor: otherMember, computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden')
  assert.deepEqual(calls, [])
})
