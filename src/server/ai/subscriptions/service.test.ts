import assert from 'node:assert/strict'
import test from 'node:test'
import { SubscriptionService } from './service'
import type { SubscriptionRepository } from './repository'
import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'

class FakeRepository {
  order: string[] = []
  state: Record<string, unknown> | null = null
  async reserveAuthorization(args: Record<string, unknown>) {
    const leaseUntil = this.state?.leaseUntil
    if (typeof leaseUntil === 'number' && leaseUntil > Date.now()) {
      throw new Error('Subscription connection is busy')
    }
    this.order.push('reserve')
    const generation = Number(this.state?.generation ?? 0) + 1
    const revision = Number(this.state?.revision ?? 0) + 1
    this.state = {
      ...args, generation, revision, phase: 'pending', cleanupRefs: [],
      leaseUntil: Date.now() + 30_000, leaseOperation: 'authorization',
    }
    return { generation, revision, cleanupRefs: [] }
  }
  async savePendingAuthorization(args: Record<string, unknown>) {
    this.order.push('commit-pending')
    const revision = Number(args.revision ?? this.state?.revision) + 1
    this.state = {
      ...this.state, ...args, revision,
      leaseToken: undefined, leaseUntil: undefined, leaseOperation: undefined,
    }
    return { revision, cleanupRefs: [] }
  }
  async get() { return this.state }
  async failClosed() { return [] }
  async disconnect() { return [] }
  async acquirePoll() { throw new Error('not used') }
  async releasePendingPoll() { return }
  async acquireRefresh() { throw new Error('not used') }
  async commitCredentialForDiscovery() { throw new Error('not used') }
  async acquireDiscovery() { throw new Error('not used') }
  async releaseDiscovery() { return }
  async commitActive() { throw new Error('not used') }
  async forDispatch() { return null }
  async revokeAllByUser() { return [] }
  async removeCleanupRef() { return }
  async forgetAllByUser() { return }
  async forgetDisconnected() { return }
  async listByUser() { return [] }
}

class FakeCredentials {
  values = new Map<string, string>()
  deleted: string[] = []
  async write(args: { apiKey: string }) {
    const ref = `vault-${this.values.size + 1}`
    this.values.set(ref, args.apiKey)
    return ref
  }
  async read(ref: string) { return this.values.get(ref) ?? null }
  async update() { throw new Error('subscription credentials are immutable') }
  async delete(ref: string) { this.deleted.push(ref); this.values.delete(ref) }
}

function createService(repository: FakeRepository, credentials: FakeCredentials, fetcher: typeof fetch) {
  return new SubscriptionService(
    repository as unknown as SubscriptionRepository,
    credentials as unknown as ByokCredentialStore,
    fetcher,
  )
}

test('Codex authorization reserves a durable generation before requesting and vaulting device material', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex,xai'
  const repository = new FakeRepository()
  const credentials = new FakeCredentials()
  const service = createService(repository, credentials, async (_input, init) => {
    repository.order.push('upstream-device-code')
    assert.equal(init?.redirect, 'error')
    return Response.json({
      device_auth_id: 'device-secret',
      user_code: 'ABCD-1234',
      interval: '5',
    })
  })

  const authorization = await service.startAuthorization('owner-1', 'connection-1', 'codex')
  assert.deepEqual(repository.order, ['reserve', 'upstream-device-code', 'commit-pending'])
  assert.equal(authorization.userCode, 'ABCD-1234')
  const [reference] = [...credentials.values.keys()]
  assert.ok(reference)
  assert.match(credentials.values.get(reference) ?? '', /device-secret/)
  assert.equal(repository.state?.pendingStateRef, reference)
  assert.equal(repository.state?.ownerId, undefined)
  assert.equal(service.isEnabled('codex'), true)
  assert.equal(service.isEnabled('xai'), false)
})

test('ambiguous pending-state commit keeps a vault candidate referenced by durable state', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex'
  const repository = new FakeRepository()
  repository.savePendingAuthorization = async function (args) {
    this.state = { ...this.state, ...args, revision: 2 }
    throw new Error('ambiguous commit response')
  }
  const credentials = new FakeCredentials()
  const service = createService(repository, credentials, async () => Response.json({
    device_auth_id: 'device-secret',
    user_code: 'ABCD-1234',
    interval: '5',
  }))

  await assert.rejects(
    service.startAuthorization('owner-1', 'connection-1', 'codex'),
    /operation failed/,
  )
  assert.equal(credentials.deleted.length, 0)
  assert.equal(repository.state?.pendingStateRef, 'vault-1')
})

test('service instances coordinate authorization through shared durable state', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex'
  const repository = new FakeRepository()
  const credentials = new FakeCredentials()
  let releaseFetch!: () => void
  const heldFetch = new Promise<void>((resolve) => { releaseFetch = resolve })
  let requestCount = 0
  const fetcher: typeof fetch = async () => {
    requestCount += 1
    await heldFetch
    return Response.json({
      device_auth_id: 'device-secret',
      user_code: 'ABCD-1234',
      interval: '5',
    })
  }
  const firstService = createService(repository, credentials, fetcher)
  const secondService = createService(repository, credentials, fetcher)
  const first = firstService.startAuthorization('owner-1', 'connection-1', 'codex')
  await new Promise<void>((resolve) => setImmediate(resolve))

  await assert.rejects(
    secondService.startAuthorization('owner-1', 'connection-1', 'codex'),
    /busy/,
  )
  assert.equal(requestCount, 1)
  releaseFetch()
  await first
  assert.equal(requestCount, 1)
})
