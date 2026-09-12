import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  SandboxCreateRequest,
  SandboxInstance,
  SandboxRuntime,
} from '@overlay/sandbox-runtime'

import type { Computer } from '@overlay/workspace-contracts'

import {
  ComputerService,
  ComputerServiceError,
} from './ComputerService'
import type { ComputerRepository } from './ComputerRepository'

const member = { userId: 'user-1', principalId: 'principal-1', workspaceRole: 'member' as const }
const otherMember = { userId: 'user-2', principalId: 'principal-2', workspaceRole: 'member' as const }
const owner = { userId: 'user-9', principalId: 'principal-9', workspaceRole: 'owner' as const }

class MemoryRepository implements ComputerRepository {
  rows = new Map<string, Computer>()
  async create(row: Computer) { this.rows.set(row.id, { ...row }); return row }
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
  async delete(id: string) { this.rows.delete(id) }
}

class FakeInstance {
  readonly provider = 'fake'
  readonly capabilities = { desktop: true }
  reference: string
  state = 'running'
  resumes = 0
  stops = 0
  deletes = 0
  desktopCalls = 0
  constructor(readonly requests: SandboxCreateRequest[], index: number) {
    this.reference = `machine-${index}`
  }
  async status() { return this.state }
  async resume() { this.resumes += 1; this.state = 'running' }
  async stop() { this.stops += 1; this.state = 'stopped' }
  async delete() { this.deletes += 1; this.state = 'deleted' }
  async desktop() { this.desktopCalls += 1; return { ready: true, url: 'https://stream.example/t', mode: 'webrtc' as const } }
  async fork() { throw new Error('not implemented') }
}

class FakeRuntime implements SandboxRuntime {
  readonly provider = 'fake' as never
  readonly capabilities = { desktop: true } as never
  creates: SandboxCreateRequest[] = []
  instances: FakeInstance[] = []
  reconnects = 0
  fail = false
  async create(request: SandboxCreateRequest) {
    this.creates.push(request)
    if (this.fail) throw new Error('provider down')
    const instance = new FakeInstance(this.creates, this.creates.length)
    this.instances.push(instance)
    return instance as unknown as SandboxInstance
  }
  async reconnect(reference: string) {
    this.reconnects += 1
    return this.instances.find((instance) => instance.reference === reference) as unknown as SandboxInstance
  }
  async restore() { throw new Error('not implemented') }
  async deleteSnapshot() {}
  /** Tests: register a machine under a fixed reference (e.g. a provider migration). */
  seed(reference: string) {
    const instance = new FakeInstance(this.creates, 0)
    instance.reference = reference
    this.instances.push(instance)
    return instance
  }
}

function service(overrides: {
  repository?: MemoryRepository
  runtimes?: Record<string, FakeRuntime>
  agents?: Record<string, { visibility: 'workspace' | 'creator'; createdByPrincipalId: string }>
  limits?: { maxPerWorkspace?: number; maxPersonalPerUser?: number; allowedSizes?: readonly ('small' | 'default' | 'large')[] }
} = {}) {
  const repository = overrides.repository ?? new MemoryRepository()
  const runtimes = overrides.runtimes ?? { box: new FakeRuntime() }
  const agents = overrides.agents ?? {}
  const svc = new ComputerService({
    repository,
    runtimeFor: (provider) => runtimes[provider],
    agentOwner: async (_workspaceId, agentId) => agents[agentId] ?? null,
    limits: overrides.limits,
    newId: (() => { let n = 0; return () => `computer-${++n}` })(),
    sleep: async () => {},
  })
  return { svc, repository, runtimes }
}

test('provision is idempotent per owner and stamps provider + env tags', async () => {
  const { svc, repository, runtimes } = service()
  const first = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'small' })
  const second = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'large' })

  assert.equal(first.id, second.id)
  assert.equal(runtimes.box.creates.length, 1)
  assert.equal(first.provider, 'box')
  assert.equal(first.providerRef, 'machine-1')
  assert.equal(first.status, 'ready')
  assert.deepEqual(runtimes.box.creates[0].resources, { vcpus: 2, memoryGiB: 4, diskGiB: 40 })
  assert.equal(runtimes.box.creates[0].environment?.OVERLAY_OWNER_ID, 'user-1')
  assert.equal(runtimes.box.creates[0].environment?.OVERLAY_COMPUTER_ID, first.id)
  assert.equal(repository.rows.size, 1)
})

test('provision enforces workspace and personal quotas and size allowlists', async () => {
  const { svc } = service({ limits: { maxPerWorkspace: 1 } })
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  await assert.rejects(
    svc.provision({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-2' }),
    (error) => error instanceof ComputerServiceError && error.code === 'quota_exceeded',
  )

  const { svc: sized } = service({ limits: { allowedSizes: ['small'] } })
  await assert.rejects(
    sized.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1', size: 'large' }),
    (error) => error instanceof ComputerServiceError && error.code === 'size_not_allowed',
  )
})

test('nobody can create or open another member’s personal computer', async () => {
  const { svc } = service()
  await assert.rejects(
    svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-2' }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  await assert.rejects(
    svc.openDesktop({ actor: otherMember, computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
})

test('workspace agents’ computers open to every member; creator-only opens to creator and owner', async () => {
  const agents = {
    'agent-shared': { visibility: 'workspace' as const, createdByPrincipalId: 'principal-1' },
    'agent-private': { visibility: 'creator' as const, createdByPrincipalId: 'principal-1' },
  }
  const { svc } = service({ agents })

  const shared = await svc.provision({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-shared' })
  const sharedTicket = await svc.openDesktop({ actor: otherMember, computerId: shared.id })
  assert.equal(sharedTicket.ready, true)

  const private_ = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-private' })
  await assert.rejects(
    svc.openDesktop({ actor: otherMember, computerId: private_.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
  assert.equal((await svc.openDesktop({ actor: member, computerId: private_.id })).ready, true)
  assert.equal((await svc.openDesktop({ actor: owner, computerId: private_.id })).ready, true)
})

test('openDesktop resumes a stopped computer and returns a stream ticket', async () => {
  const { svc, repository, runtimes } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  const instance = runtimes.box.instances[0] as unknown as FakeInstance
  instance.state = 'stopped'
  await repository.update(computer.id, { status: 'stopped' })

  const ticket = await svc.openDesktop({ actor: member, computerId: computer.id, mode: 'vnc' })
  assert.equal(ticket.ready, true)
  assert.equal(instance.resumes, 1)
  assert.equal(instance.desktopCalls, 1)
  assert.ok(repository.rows.get(computer.id)!.lastActiveAt !== null)
})

test('the adapter is resolved from the row’s provider, not the deployment default', async () => {
  const repository = new MemoryRepository()
  const box = new FakeRuntime()
  const acme = new FakeRuntime()
  const { svc } = service({ repository, runtimes: { box, acme } })
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  // Simulate the row pointing at a machine that lives on a second provider.
  const moved = acme.seed(computer.providerRef!)
  await repository.update(computer.id, { provider: 'acme' })

  await svc.openDesktop({ actor: member, computerId: computer.id })
  assert.equal(moved.desktopCalls, 1)
  assert.equal((box.instances[0] as unknown as FakeInstance).desktopCalls, 0)
})

test('stop and destroy drive the provider machine and the row', async () => {
  const { svc, repository, runtimes } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  const instance = runtimes.box.instances[0] as unknown as FakeInstance

  await svc.stop({ actor: member, computerId: computer.id })
  assert.equal(instance.stops, 1)
  assert.equal(repository.rows.get(computer.id)!.status, 'stopped')

  await svc.destroy({ actor: member, computerId: computer.id })
  assert.equal(instance.deletes, 1)
  assert.equal(repository.rows.size, 0)
})

test('a failed provider marks the row error instead of leaving it stuck provisioning', async () => {
  const runtime = new FakeRuntime()
  runtime.fail = true
  const { svc, repository } = service({ runtimes: { box: runtime } })
  await assert.rejects(
    svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    (error) => error instanceof ComputerServiceError && error.code === 'provider_error',
  )
  const row = [...repository.rows.values()][0]
  assert.equal(row.status, 'error')
  assert.equal(row.providerRef, null)
})

test('missing provider configuration fails closed', async () => {
  const { svc } = service({ runtimes: {} })
  await assert.rejects(
    svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    (error) => error instanceof ComputerServiceError && error.code === 'provider_unavailable',
  )
})

test('getForActor reads a row without reconnecting and enforces access', async () => {
  const agents = { 'agent-private': { visibility: 'creator' as const, createdByPrincipalId: 'principal-1' } }
  const { svc, repository, runtimes } = service({ agents })
  const mine = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  const private_ = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-private' })

  assert.equal((await svc.getForActor({ actor: member, computerId: mine.id })).id, mine.id)
  assert.equal((await svc.getForActor({ actor: member, computerId: private_.id })).id, private_.id)
  // getForActor must not touch the provider — reconnect is never invoked.
  assert.equal(runtimes.box.reconnects, 0)

  await assert.rejects(
    svc.getForActor({ actor: otherMember, computerId: mine.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
  await assert.rejects(
    svc.getForActor({ actor: otherMember, computerId: private_.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
  await assert.rejects(
    svc.getForActor({ actor: member, computerId: 'missing' }),
    (error) => error instanceof ComputerServiceError && error.code === 'not_found',
  )
  assert.equal(repository.rows.size, 2)
})

test('listForWorkspace only returns computers the actor may see', async () => {
  const agents = { 'agent-private': { visibility: 'creator' as const, createdByPrincipalId: 'principal-1' } }
  const { svc } = service({ agents })
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  await svc.provision({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-2' })
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-private' })

  const mine = await svc.listForWorkspace({ actor: member, workspaceId: 'ws-1' })
  assert.equal(mine.length, 2)
  const theirs = await svc.listForWorkspace({ actor: otherMember, workspaceId: 'ws-1' })
  assert.deepEqual(theirs.map((computer) => computer.ownerId), ['user-2'])
  // The workspace owner sees the creator-only agent's computer via the owner
  // override, but not either member's personal computer.
  const owners = await svc.listForWorkspace({ actor: owner, workspaceId: 'ws-1' })
  assert.equal(owners.length, 1)
})
