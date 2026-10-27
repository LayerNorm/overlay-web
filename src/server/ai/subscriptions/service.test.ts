import assert from 'node:assert/strict'
import test from 'node:test'
import { SubscriptionService } from './service'
import type { SubscriptionRepository } from './repository'
import type { ByokCredentialContext, ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import {
  CODEX_ISSUER,
  CODEX_REFRESH_MARGIN_MS,
  type CodexTokenSet,
} from '@/server/agents/provider-accounts/codex-subscription'
import { CODEX_MODELS_URL } from './codex-discovery'

class FakeRepository {
  order: string[] = []
  state: Record<string, unknown> | null = null
  reads = 0
  forgetDisconnectedCalls = 0
  forgetAllCalls = 0

  async reserveAuthorization(args: Record<string, unknown>) {
    const leaseUntil = this.state?.leaseUntil
    if (typeof leaseUntil === 'number' && leaseUntil > Date.now()) {
      throw new Error('Subscription connection is busy')
    }
    this.order.push('reserve')
    const generation = Number(this.state?.generation ?? 0) + 1
    const revision = Number(this.state?.revision ?? 0) + 1
    const cleanupRefs = Array.isArray(this.state?.cleanupRefs)
      ? this.state.cleanupRefs as string[]
      : []
    this.state = {
      ...(this.state ?? {}), ...args, generation, revision, phase: 'pending', cleanupRefs,
      leaseUntil: Date.now() + 30_000, leaseOperation: 'authorization',
    }
    return { generation, revision, cleanupRefs }
  }

  async registerPendingWrite(args: { name: string }) {
    if (!this.state) throw new Error('Subscription connection not found')
    const pendingWrites = Array.isArray(this.state.pendingWrites)
      ? this.state.pendingWrites as Array<{ name: string; createdAt: number }>
      : []
    this.state = {
      ...this.state,
      pendingWrites: [...pendingWrites, { name: args.name, createdAt: Date.now() }],
    }
    this.order.push('register-pending-write')
  }

  async clearPendingWrite(args: { name: string }) {
    if (!this.state) return
    const pendingWrites = Array.isArray(this.state.pendingWrites)
      ? this.state.pendingWrites as Array<{ name: string; createdAt: number }>
      : []
    this.state = {
      ...this.state,
      pendingWrites: pendingWrites.filter((write) => write.name !== args.name),
    }
  }

  async savePendingAuthorization(args: Record<string, unknown>) {
    this.order.push('commit-pending')
    const revision = Number(args.revision ?? this.state?.revision) + 1
    const { pendingWriteName, ...savedArgs } = args
    const pendingWrites = Array.isArray(this.state?.pendingWrites)
      ? this.state.pendingWrites as Array<{ name: string; createdAt: number }>
      : []
    this.state = {
      ...this.state, ...savedArgs, revision,
      pendingWrites: pendingWrites.filter((write) => write.name !== pendingWriteName),
      leaseToken: undefined, leaseUntil: undefined, leaseOperation: undefined,
    }
    return {
      revision,
      cleanupRefs: Array.isArray(this.state.cleanupRefs) ? this.state.cleanupRefs as string[] : [],
    }
  }

  async commitCredentialForDiscovery(args: Record<string, unknown>) {
    const pendingWrites = Array.isArray(this.state?.pendingWrites)
      ? this.state.pendingWrites as Array<{ name: string; createdAt: number }>
      : []
    const cleanupRefs = Array.isArray(this.state?.cleanupRefs)
      ? this.state.cleanupRefs as string[]
      : []
    const previousRef = typeof this.state?.credentialRef === 'string' ? this.state.credentialRef : undefined
    const nextCleanupRefs = [...new Set([...cleanupRefs, ...(previousRef ? [previousRef] : [])])]
      .filter((ref) => ref !== args.credentialRef)
    const revision = Number(this.state?.revision ?? args.revision) + 1
    this.state = {
      ...this.state,
      phase: 'discovering',
      credentialRef: args.credentialRef,
      pendingStateRef: undefined,
      revision,
      cleanupRefs: nextCleanupRefs,
      pendingWrites: pendingWrites.filter((write) => write.name !== args.pendingWriteName),
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
    }
    return { revision, cleanupRefs: nextCleanupRefs }
  }

  async acquireRefresh() {
    return {
      generation: Number(this.state?.generation ?? 1),
      revision: Number(this.state?.revision ?? 1),
      credentialRef: String(this.state?.credentialRef ?? ''),
      providerId: 'codex' as const,
    }
  }

  async acquireDiscovery() {
    return {
      generation: Number(this.state?.generation ?? 1),
      revision: Number(this.state?.revision ?? 1),
      credentialRef: String(this.state?.credentialRef ?? ''),
      providerId: 'codex' as const,
    }
  }

  async commitActive(args: Record<string, unknown>) {
    const revision = Number(this.state?.revision ?? args.revision) + 1
    this.state = {
      ...this.state,
      ...args,
      phase: 'active',
      revision,
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
    }
    return {
      revision,
      enabledModelIds: Array.isArray(args.discoveredModelIds) ? args.discoveredModelIds : [],
      cleanupRefs: Array.isArray(this.state.cleanupRefs) ? this.state.cleanupRefs as string[] : [],
    }
  }
  async get() { this.reads += 1; return this.state }
  async failClosed() { return [] }
  async disconnect() {
    const cleanupRefs = Array.isArray(this.state?.cleanupRefs) ? this.state.cleanupRefs as string[] : []
    this.state = { ...this.state, phase: 'disconnected', cleanupRefs }
    return cleanupRefs
  }
  async acquirePoll() { throw new Error('not used') }
  async releasePendingPoll() { return }
  async releaseDiscovery() { return }
  async forDispatch() {
    if (this.state?.phase !== 'active' || typeof this.state.credentialRef !== 'string') return null
    return {
      providerId: 'codex' as const,
      credentialRef: this.state.credentialRef,
      generation: Number(this.state.generation ?? 1),
    }
  }
  async revokeAllByUser() {
    const cleanupRefs = Array.isArray(this.state?.cleanupRefs) ? this.state.cleanupRefs as string[] : []
    this.state = { ...this.state, phase: 'disconnected', cleanupRefs }
    return cleanupRefs
  }
  async removeCleanupRef(args: { credentialRef: string }) {
    if (!this.state || !Array.isArray(this.state.cleanupRefs)) return
    this.state = {
      ...this.state,
      cleanupRefs: (this.state.cleanupRefs as string[]).filter((ref) => ref !== args.credentialRef),
    }
  }
  async retainCleanupRef(args: { credentialRef: string; pendingWriteName?: string }) {
    const cleanupRefs = Array.isArray(this.state?.cleanupRefs) ? this.state.cleanupRefs as string[] : []
    const pendingWrites = Array.isArray(this.state?.pendingWrites)
      ? this.state.pendingWrites as Array<{ name: string; createdAt: number }>
      : []
    this.state = {
      ...this.state,
      cleanupRefs: [...new Set([...cleanupRefs, args.credentialRef])],
      pendingWrites: pendingWrites.filter((write) => write.name !== args.pendingWriteName),
    }
  }
  async forgetDisconnected() {
    this.forgetDisconnectedCalls += 1
    this.state = null
  }
  async forgetAllByUser() {
    this.forgetAllCalls += 1
    this.state = null
  }
  async releaseRefresh() { return }
  async listByUser() { return this.state ? [this.state] : [] }
}

class FakeCredentials {
  values = new Map<string, string>()
  namesByRef = new Map<string, string>()
  deleted: string[] = []
  deletedNames: string[] = []
  contexts: ByokCredentialContext[] = []
  order?: string[]
  private nameCounter = 0

  newCredentialName() {
    this.nameCounter += 1
    return `credential-name-${this.nameCounter}`
  }

  nameForRef(ref: string) {
    return this.namesByRef.get(ref) ?? 'unknown-credential-name'
  }

  async write(args: { apiKey: string; context?: ByokCredentialContext; name?: string }) {
    this.order?.push('write')
    if (args.context) this.contexts.push(args.context)
    const ref = `vault-${this.values.size + 1}`
    const name = args.name ?? this.newCredentialName()
    this.values.set(ref, args.apiKey)
    this.namesByRef.set(ref, name)
    return ref
  }
  async read(ref: string) { return this.values.get(ref) ?? null }
  async update() { throw new Error('subscription credentials are immutable') }
  async delete(ref: string) { this.deleted.push(ref); this.values.delete(ref); this.namesByRef.delete(ref) }
  async deleteByName(name: string) {
    this.deletedNames.push(name)
    const ref = [...this.namesByRef].find(([, storedName]) => storedName === name)?.[0]
    if (ref) await this.delete(ref)
  }
}

function createService(repository: FakeRepository, credentials: FakeCredentials, fetcher: typeof fetch) {
  credentials.order = repository.order
  return new SubscriptionService(
    repository as unknown as SubscriptionRepository,
    credentials as unknown as ByokCredentialStore,
    fetcher,
  )
}

test('an ambiguous credential commit never deletes a candidate activated by another instance', async () => {
  const repository = new FakeRepository()
  const credentials = new FakeCredentials()
  const candidate = await credentials.write({ apiKey: 'opaque-test-credential' })
  repository.commitCredentialForDiscovery = async () => {
    repository.state = { phase: 'active', credentialRef: candidate, cleanupRefs: [] }
    throw new Error('acknowledgment lost after concurrent discovery')
  }
  const service = createService(repository, credentials, async () => { throw new Error('unused') })
  const committed = await (service as unknown as {
    commitCredentialCandidate(args: object, candidate: { ref: string; name: string }): Promise<boolean>
  }).commitCredentialCandidate({
    userId: 'owner-1', connectionId: 'connection-1', generation: 1, revision: 1, leaseToken: 'lease',
  }, { ref: candidate, name: credentials.nameForRef(candidate) })
  assert.equal(committed, true)
  assert.deepEqual(credentials.deleted, [])
  assert.equal(credentials.values.has(candidate), true)
})

test('a rejected candidate is retained for cleanup if vault deletion fails', async () => {
  const repository = new FakeRepository()
  repository.state = { phase: 'disconnected', cleanupRefs: [] }
  repository.commitCredentialForDiscovery = async () => { throw new Error('candidate rejected') }
  const credentials = new FakeCredentials()
  credentials.delete = async () => { throw new Error('vault unavailable') }
  const service = createService(repository, credentials, async () => { throw new Error('unused') })
  const committed = await (service as unknown as {
    commitCredentialCandidate(args: object, candidate: { ref: string; name: string }): Promise<boolean>
  }).commitCredentialCandidate({
    userId: 'owner-1', connectionId: 'connection-1', generation: 1, revision: 1, leaseToken: 'lease',
  }, { ref: 'rejected-candidate', name: 'rejected-name' })
  assert.equal(committed, false)
  assert.deepEqual(repository.state?.cleanupRefs, ['rejected-candidate'])
})

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
  assert.deepEqual(repository.order, [
    'reserve', 'upstream-device-code', 'register-pending-write', 'write', 'commit-pending',
  ])
  assert.equal(authorization.userCode, 'ABCD-1234')
  const [reference] = [...credentials.values.keys()]
  assert.ok(reference)
  assert.match(credentials.values.get(reference) ?? '', /device-secret/)
  assert.equal(repository.state?.pendingStateRef, reference)
  assert.equal(repository.state?.ownerId, undefined)
  assert.equal(credentials.contexts[0]?.providerId, 'subscription-codex')
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
  const savePendingAuthorization = repository.savePendingAuthorization.bind(repository)
  repository.savePendingAuthorization = async (args) => {
    await savePendingAuthorization(args)
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
  assert.deepEqual(repository.state?.pendingWrites, [])
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

test('a stale pending write is reclaimed after a crash before the reference commit', async () => {
  const repository = new FakeRepository()
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    revision: 1,
    phase: 'active',
    credentialRef: 'existing-credential',
    cleanupRefs: [],
    pendingWrites: [],
  }
  const credentials = new FakeCredentials()
  const service = createService(repository, credentials, async () => { throw new Error('unused') })
  const writeSecret = (service as unknown as {
    writeSecret(userId: string, connectionId: string, providerId: 'codex', value: string):
      Promise<{ ref: string; name: string }>
  }).writeSecret

  const candidate = await writeSecret.call(service, 'owner-1', 'connection-1', 'codex', 'orphaned-snapshot')
  const readsBeforeFailedCommit = repository.reads
  repository.commitCredentialForDiscovery = async () => { throw new Error('commit acknowledgement unavailable') }
  await assert.rejects(
    repository.commitCredentialForDiscovery({
      userId: 'owner-1',
      connectionId: 'connection-1',
      credentialRef: candidate.ref,
      pendingWriteName: candidate.name,
    }),
    /commit acknowledgement unavailable/,
  )
  assert.equal(repository.reads, readsBeforeFailedCommit)
  const pendingWrites = repository.state?.pendingWrites as Array<{ name: string; createdAt: number }>
  pendingWrites[0]!.createdAt = Date.now() - 5 * 60_000 - 1

  const result = await service.poll('owner-1', 'connection-1')

  assert.equal(result.status, 'connected')
  assert.deepEqual(credentials.deletedNames, [candidate.name])
  assert.deepEqual(repository.state?.pendingWrites, [])
})

test('fresh pending writes are not deleted by stale reconciliation', async () => {
  const repository = new FakeRepository()
  const createdAt = Date.now()
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    revision: 1,
    phase: 'active',
    credentialRef: 'existing-credential',
    cleanupRefs: [],
    pendingWrites: [{ name: 'fresh-write', createdAt }],
  }
  const credentials = new FakeCredentials()
  const service = createService(repository, credentials, async () => { throw new Error('unused') })

  const result = await service.poll('owner-1', 'connection-1')

  assert.equal(result.status, 'connected')
  assert.deepEqual(credentials.deletedNames, [])
  assert.deepEqual(repository.state?.pendingWrites, [{ name: 'fresh-write', createdAt }])
})

for (const operation of ['disconnect', 'revokeAllForUser'] as const) {
  test(`${operation} retains pending names while a vault write may still create its object`, async () => {
    const repository = new FakeRepository()
    const name = 'in-flight-credential'
    const createdAt = Date.now()
    repository.state = {
      userId: 'owner-1', connectionId: 'connection-1', providerId: 'codex',
      phase: 'pending', generation: 1, revision: 1, cleanupRefs: [],
      leaseUntil: Date.now() + 60_000,
      pendingWrites: [{ name, createdAt }],
    }
    const credentials = new FakeCredentials()
    const service = createService(repository, credentials, async () => { throw new Error('unused') })
    const revoke = () => operation === 'disconnect'
      ? service.disconnect('owner-1', 'connection-1')
      : service.revokeAllForUser('owner-1')

    await assert.rejects(revoke(), /Subscription cleanup is pending/)
    assert.deepEqual(credentials.deletedNames, [])
    assert.equal(repository.forgetDisconnectedCalls + repository.forgetAllCalls, 0)
    assert.deepEqual(repository.state?.pendingWrites, [{ name, createdAt }])

    // The provider finishes creating the object, but the writer crashes before committing its reference.
    await credentials.write({ name, apiKey: 'late-credential' })
    repository.state = { ...repository.state, leaseUntil: Date.now() - 1 }
    await revoke()
    assert.deepEqual(credentials.deletedNames, [name])
    assert.equal(credentials.values.size, 0)
    assert.equal(repository.state, null)
  })
}

test('disconnect reconciles all pending writes and does not forget state after a deletion failure', async () => {
  const repository = new FakeRepository()
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    revision: 1,
    phase: 'active',
    cleanupRefs: [],
    pendingWrites: [
      { name: 'first-write', createdAt: Date.now() },
      { name: 'second-write', createdAt: Date.now() },
    ],
  }
  const credentials = new FakeCredentials()
  credentials.deleteByName = async (name) => {
    credentials.deletedNames.push(name)
    if (name === 'second-write') throw new Error('Vault unavailable')
  }
  const service = createService(repository, credentials, async () => { throw new Error('unused') })

  await assert.rejects(service.disconnect('owner-1', 'connection-1'), /Subscription cleanup is pending/)

  assert.deepEqual(credentials.deletedNames, ['first-write', 'second-write'])
  assert.deepEqual(
    (repository.state?.pendingWrites as Array<{ name: string }>).map((write) => write.name),
    ['second-write'],
  )
  assert.equal(repository.forgetDisconnectedCalls, 0)
})

test('account revocation reconciles pending writes and does not forget state after a deletion failure', async () => {
  const repository = new FakeRepository()
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    revision: 1,
    phase: 'active',
    cleanupRefs: [],
    pendingWrites: [{ name: 'account-orphan', createdAt: Date.now() }],
  }
  const credentials = new FakeCredentials()
  credentials.deleteByName = async (name) => {
    credentials.deletedNames.push(name)
    throw new Error('Vault unavailable')
  }
  const service = createService(repository, credentials, async () => { throw new Error('unused') })

  await assert.rejects(service.revokeAllForUser('owner-1'), /Subscription cleanup is pending/)

  assert.deepEqual(credentials.deletedNames, ['account-orphan'])
  assert.equal(repository.forgetAllCalls, 0)
  assert.deepEqual(
    (repository.state?.pendingWrites as Array<{ name: string }>).map((write) => write.name),
    ['account-orphan'],
  )
})

test('failed credential writes attempt name-based cleanup before clearing pending state', async () => {
  const repository = new FakeRepository()
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    phase: 'active',
    cleanupRefs: [],
    pendingWrites: [],
  }
  const credentials = new FakeCredentials()
  credentials.write = async () => { throw new Error('Vault write failed') }
  const service = createService(repository, credentials, async () => { throw new Error('unused') })
  const writeSecret = (service as unknown as {
    writeSecret(userId: string, connectionId: string, providerId: 'codex', value: string): Promise<unknown>
  }).writeSecret

  await assert.rejects(
    writeSecret.call(service, 'owner-1', 'connection-1', 'codex', 'snapshot'),
    /Vault write failed/,
  )

  assert.deepEqual(credentials.deletedNames, ['credential-name-1'])
  assert.deepEqual(repository.state?.pendingWrites, [])
})

test('credential dispatch refreshes a near-expiry Codex token before returning it', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex'
  const repository = new FakeRepository()
  const oldAccessToken = `header.${Buffer.from(JSON.stringify({
    exp: Math.floor((Date.now() + CODEX_REFRESH_MARGIN_MS - 60_000) / 1000),
  })).toString('base64url')}.signature`
  const refreshedAccessToken = `header.${Buffer.from(JSON.stringify({
    exp: Math.ceil((Date.now() + CODEX_REFRESH_MARGIN_MS + 60_000) / 1000),
  })).toString('base64url')}.signature`
  const oldTokens: CodexTokenSet = {
    v: 1,
    idToken: 'old-id-token',
    accessToken: oldAccessToken,
    refreshToken: 'old-refresh-token',
    accountId: 'account-1',
    lastRefresh: Date.now(),
  }
  const credentials = new FakeCredentials()
  const oldRef = await credentials.write({ apiKey: JSON.stringify(oldTokens) })
  repository.state = {
    userId: 'owner-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    revision: 1,
    phase: 'active',
    credentialRef: oldRef,
    cleanupRefs: [],
    pendingWrites: [],
  }
  const requestedUrls: string[] = []
  const service = createService(repository, credentials, async (input, init) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url === `${CODEX_ISSUER}/oauth/token`) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      assert.equal(body.grant_type, 'refresh_token')
      assert.equal(body.refresh_token, 'old-refresh-token')
      return Response.json({
        id_token: 'refreshed-id-token',
        access_token: refreshedAccessToken,
        refresh_token: 'refreshed-refresh-token',
      })
    }
    if (url === CODEX_MODELS_URL) {
      return Response.json({ models: [{ slug: 'codex-model', display_name: 'Codex Model' }] })
    }
    throw new Error('Unexpected Codex request')
  })

  const result = await service.credentialForDispatch('owner-1', 'connection-1', 'codex-model')

  assert.equal(result?.accessToken, refreshedAccessToken)
  assert.equal(result?.refreshToken, 'refreshed-refresh-token')
  assert.ok(requestedUrls.includes(`${CODEX_ISSUER}/oauth/token`))
  assert.ok(requestedUrls.includes(CODEX_MODELS_URL))
  assert.notEqual(repository.state?.credentialRef, oldRef)
})
