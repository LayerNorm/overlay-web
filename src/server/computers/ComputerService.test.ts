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
import type { ComputerLeaseSeed, ComputerRepository } from './ComputerRepository'

const member = { workspaceId: 'ws-1', userId: 'user-1', principalId: 'principal-1', workspaceRole: 'member' as const }
const otherMember = { workspaceId: 'ws-1', userId: 'user-2', principalId: 'principal-2', workspaceRole: 'member' as const }
const owner = { workspaceId: 'ws-1', userId: 'user-9', principalId: 'principal-9', workspaceRole: 'owner' as const }

class MemoryRepository implements ComputerRepository {
  rows = new Map<string, Computer>()
  leases = new Map<string, ComputerLeaseSeed>()
  async create(row: Computer) {
    const existing = [...this.rows.values()].find((candidate) => candidate.workspaceId === row.workspaceId && candidate.ownerType === row.ownerType && candidate.ownerId === row.ownerId)
    if (existing) return existing
    this.rows.set(row.id, { ...row })
    return row
  }
  async createWithLease(row: Computer, lease: ComputerLeaseSeed) {
    const existing = await this.findByOwner(row.workspaceId, row.ownerType, row.ownerId)
    const computer = existing ?? await this.create(row)
    if (!this.leases.has(lease.id)) this.leases.set(lease.id, { ...lease, computerId: computer.id })
    return { computer, created: !existing }
  }
  async bindProviderReference(args: { computerId: string; reference: string }) {
    const computer = this.rows.get(args.computerId)
    if (!computer) return null
    const updated = { ...computer, providerRef: args.reference }
    this.rows.set(computer.id, updated)
    return updated
  }
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
  reconnectOptions: Array<{ resume?: boolean } | undefined> = []
  fail = false
  failuresLeft = 0
  async create(request: SandboxCreateRequest) {
    this.creates.push(request)
    if (this.fail || this.failuresLeft-- > 0) throw new Error('provider down')
    const instance = new FakeInstance(this.creates, this.creates.length)
    this.instances.push(instance)
    return instance as unknown as SandboxInstance
  }
  async reconnect(reference: string, options?: { resume?: boolean }) {
    this.reconnects += 1
    this.reconnectOptions.push(options)
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
  assertCanRun?: (input: { workspaceId: string; userId: string; agentId?: string }) => Promise<void>
} = {}) {
  const repository = overrides.repository ?? new MemoryRepository()
  const runtimes = overrides.runtimes ?? { box: new FakeRuntime() }
  const agents = overrides.agents ?? {}
  const svc = new ComputerService({
    repository,
    runtimeFor: (provider) => runtimes[provider],
    assertCanRun: overrides.assertCanRun ?? (async () => {}),
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

test('an ambiguous provider failure is not retried with a second allocation', async () => {
  const runtime = new FakeRuntime()
  runtime.failuresLeft = 1
  const { svc, repository } = service({ runtimes: { box: runtime } })
  await assert.rejects(svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    (error) => error instanceof ComputerServiceError && error.code === 'provider_error')
  assert.equal(runtime.creates.length, 1)
  assert.equal([...repository.rows.values()][0].status, 'error')
  assert.equal(repository.rows.size, 1)
})

test('all Computer entry points bind authorization to the target workspace', async () => {
  const { svc, runtimes } = service({
    agents: { 'agent-1': { visibility: 'workspace', createdByPrincipalId: 'principal-1' } },
  })
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' })
  const stranger = { ...owner, workspaceId: 'ws-other' }
  const requests = [
    () => svc.getForActor({ actor: stranger, computerId: computer.id }),
    () => svc.start({ actor: stranger, computerId: computer.id }),
    () => svc.stop({ actor: stranger, computerId: computer.id }),
    () => svc.openDesktop({ actor: stranger, computerId: computer.id }),
    () => svc.destroy({ actor: stranger, computerId: computer.id }),
    () => svc.destroyForOwner({ actor: stranger, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' }),
    () => svc.instanceForOwner({ actor: stranger, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' }),
    () => svc.listForWorkspace({ actor: stranger, workspaceId: 'ws-1' }),
    () => svc.provision({ actor: stranger, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' }),
  ]
  for (const request of requests) {
    await assert.rejects(request(), (error) => error instanceof ComputerServiceError && error.code === 'forbidden')
  }
  assert.equal(runtimes.box.reconnects, 0)
})

test('admission denies allocation and every wake path but permits stop and delete', async () => {
  let deny = false
  const { svc, repository, runtimes } = service({ assertCanRun: async () => {
    if (deny) throw new ComputerServiceError('insufficient_credit', 'No credit', 402)
  } })
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  const instance = runtimes.box.instances.find((candidate) => candidate.reference === computer.providerRef)!
  instance.state = 'stopped'
  deny = true
  for (const request of [
    () => svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    () => svc.start({ actor: member, computerId: computer.id }),
    () => svc.openDesktop({ actor: member, computerId: computer.id }),
    () => svc.instanceForOwner({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
  ]) {
    await assert.rejects(request(), (error) => error instanceof ComputerServiceError && error.code === 'insufficient_credit')
  }
  assert.equal(instance.resumes, 0)
  assert.equal(runtimes.box.creates.length, 1)
  assert.ok(runtimes.box.reconnectOptions.every((options) => options?.resume === false))
  await svc.stop({ actor: member, computerId: computer.id })
  await svc.destroy({ actor: member, computerId: computer.id })
  assert.equal(repository.rows.size, 0)
})

test('concurrent provisions allocate only for the winner of the owner claim', async () => {
  const { svc, repository, runtimes } = service()
  const [one, two] = await Promise.all(Array.from({ length: 2 }, () => svc.provision({
    actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
  })))
  assert.equal(one.id, two.id)
  assert.equal(repository.rows.size, 1)
  assert.equal(runtimes.box.creates.length, 1)
})

test('failed deletion retains the provider reference for a successful retry', async () => {
  const { svc, repository, runtimes } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  const instance = runtimes.box.instances.find((candidate) => candidate.reference === computer.providerRef)!
  instance.delete = async () => { throw new Error('Provider unavailable') }
  await assert.rejects(svc.destroy({ actor: member, computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'provider_error')
  assert.equal((await repository.get(computer.id))?.providerRef, computer.providerRef)
  instance.delete = async () => { instance.state = 'deleted' }
  await svc.destroy({ actor: member, computerId: computer.id })
  assert.equal(await repository.get(computer.id), null)
})

test('provision reclaims a dead error row instead of creating a duplicate', async () => {
  const runtime = new FakeRuntime()
  runtime.fail = true
  const { svc, repository } = service({ runtimes: { box: runtime } })
  await assert.rejects(svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }))

  runtime.fail = false
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  assert.equal(computer.status, 'ready')
  assert.equal(repository.rows.size, 1)
  assert.equal([...repository.rows.values()][0].id, computer.id)
})

test('provision reclaims a stale provisioning row but returns an in-flight one', async () => {
  const { svc, repository, runtimes } = service()
  const seed = (ownerId: string, updatedAt: number) => repository.create({
    id: `seed-${ownerId}`, workspaceId: 'ws-1', ownerType: 'user', ownerId,
    provider: 'box', providerRef: null, size: 'default', status: 'provisioning',
    name: null, createdBy: ownerId, createdAt: updatedAt, updatedAt, lastActiveAt: null,
  })

  // Stale: the create that wrote this row died mid-flight — reclaim it.
  await seed('user-1', 0)
  const reclaimed = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  assert.equal(reclaimed.status, 'ready')
  assert.equal(repository.rows.size, 1)

  // Fresh: a concurrent provision is still in flight — return its row.
  await seed('user-2', Date.now())
  const inflight = await svc.provision({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-2' })
  assert.equal(inflight.status, 'provisioning')
  assert.equal(runtimes.box.creates.length, 1)
})

test('destroy removes an error row without a provider machine', async () => {
  const runtime = new FakeRuntime()
  runtime.fail = true
  const { svc, repository } = service({ runtimes: { box: runtime } })
  await assert.rejects(svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }))
  const row = [...repository.rows.values()][0]

  await svc.destroy({ actor: member, computerId: row.id })
  assert.equal(repository.rows.size, 0)
})

test('a computer bound to a deleted agent is owner-manageable, not orphaned', async () => {
  const { svc, repository, runtimes } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  // Simulate a leftover agent-owned row whose owner no longer resolves.
  await repository.update(computer.id, { ownerType: 'agent', ownerId: 'agent-gone' })

  // Members still cannot touch it; the workspace owner can list and destroy it.
  await assert.rejects(
    svc.destroy({ actor: otherMember, computerId: computer.id }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
  const visible = await svc.listForWorkspace({ actor: owner, workspaceId: 'ws-1' })
  assert.equal(visible.length, 1)
  await svc.destroy({ actor: owner, computerId: computer.id })
  assert.equal(repository.rows.size, 0)
  assert.equal((runtimes.box.instances[0] as unknown as FakeInstance).deletes, 1)
})

test('destroyForOwner removes the bound computer and its machine', async () => {
  const { svc, repository, runtimes } = service({
    agents: { 'agent-1': { visibility: 'workspace', createdByPrincipalId: 'principal-9' } },
  })
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' })

  await svc.destroyForOwner({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' })
  assert.equal(repository.rows.size, 0)
  assert.equal((runtimes.box.instances[0] as unknown as FakeInstance).deletes, 1)

  // No bound computer → no-op, no throw.
  await svc.destroyForOwner({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' })
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

test('instanceForOwner resolves the bound computer and resumes a stopped machine', async () => {
  const { svc, runtimes } = service()
  const computer = await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })
  await svc.stop({ actor: member, computerId: computer.id })

  const resolved = await svc.instanceForOwner({
    actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
  })
  assert.equal(resolved.computer.id, computer.id)
  assert.equal(runtimes.box.instances[0]!.resumes, 1)
  assert.equal(resolved.instance.capabilities.desktop, true)
})

test('instanceForOwner rejects an owner with no computer and a stranger', async () => {
  const { svc } = service()
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' })

  await assert.rejects(
    svc.instanceForOwner({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-x' }),
    (error) => error instanceof ComputerServiceError && error.code === 'not_found',
  )
  await assert.rejects(
    svc.instanceForOwner({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1' }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
})

test('instanceForOwner lets the creator drive a creator-only agent computer', async () => {
  const { svc } = service({
    agents: { 'agent-1': { visibility: 'creator', createdByPrincipalId: 'principal-1' } },
  })
  await svc.provision({ actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' })

  const resolved = await svc.instanceForOwner({
    actor: member, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1',
  })
  assert.equal(resolved.computer.ownerId, 'agent-1')
  await assert.rejects(
    svc.instanceForOwner({ actor: otherMember, workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1' }),
    (error) => error instanceof ComputerServiceError && error.code === 'forbidden',
  )
})
