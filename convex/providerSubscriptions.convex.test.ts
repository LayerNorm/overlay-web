import { beforeAll, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'provider-subscriptions-test-secret'
const mutation = (name: string) => makeFunctionReference<'mutation'>(`providers/subscriptions:${name}`)
const connectionMutation = (name: string) =>
  makeFunctionReference<'mutation'>(`providers/connections:${name}`)
const connectionQuery = (name: string) =>
  makeFunctionReference<'query'>(`providers/connections:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`providers/subscriptions:${name}`)

for (const revoke of ['disconnect', 'revokeAllByUser']) {
  test(`${revoke} retains cleanup authority until in-flight work is fenced and drained`, async () => {
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const convex = convexTest(schema, modules)
      const pending = await createPendingAuthorization(convex)
      now += 3_000
      const args = { serverSecret: secret, userId: 'owner-1', connectionId: pending.connectionId }
      const poll = await convex.mutation(mutation('acquirePoll'), { ...args, leaseToken: 'in-flight' })
      await convex.mutation(mutation(revoke), revoke === 'disconnect'
        ? args : { serverSecret: secret, userId: 'owner-1' })
      await convex.mutation(mutation('removeCleanupRef'), { ...args, credentialRef: 'vault-pending-state' })
      await expect(convex.mutation(mutation('forgetDisconnectedByServer'), args)).rejects.toThrow(/pending/)
      await expect(convex.mutation(mutation('forgetAllByUser'), {
        serverSecret: secret, userId: 'owner-1',
      })).rejects.toThrow(/credentials remain/)
      await expect(convex.mutation(mutation('commitCredentialForDiscovery'), {
        ...args, generation: poll.generation!, revision: poll.revision!,
        leaseToken: 'in-flight', credentialRef: 'late-vault-candidate',
      })).rejects.toThrow()
      await convex.mutation(mutation('retainCleanupRef'), { ...args, credentialRef: 'late-vault-candidate' })
      now += 61_000
      await expect(convex.mutation(mutation('forgetDisconnectedByServer'), args)).rejects.toThrow(/pending/)
      await convex.mutation(mutation('removeCleanupRef'), { ...args, credentialRef: 'late-vault-candidate' })
      await convex.mutation(mutation('forgetDisconnectedByServer'), args)
      expect(await convex.query(query('getByServer'), args)).toBeNull()
    } finally {
      clock.mockRestore()
    }
  })
}

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function createPendingAuthorization(convex: ReturnType<typeof convexTest>) {
  const connectionId = await createConnection(convex)
  const reservation = await convex.mutation(mutation('reserveAuthorization'), {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId,
    providerId: 'codex',
    leaseToken: 'authorization-lease',
  })
  const pending = await convex.mutation(mutation('savePendingAuthorization'), {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId,
    generation: reservation.generation,
    revision: reservation.revision,
    leaseToken: 'authorization-lease',
    pendingStateRef: 'vault-pending-state',
    expiresAt: Date.now() + 10 * 60_000,
    pollIntervalMs: 2_000,
  })
  return { connectionId, generation: reservation.generation, revision: pending.revision }
}

async function createConnection(convex: ReturnType<typeof convexTest>) {
  return await convex.mutation(connectionMutation('createByServer'), {
    serverSecret: secret,
    userId: 'owner-1',
    providerId: 'subscription:codex',
    authKind: 'subscription',
    subscriptionProvider: 'codex',
    endpoint: '',
    displayName: 'ChatGPT subscription',
    vaultKeyName: 'subscription-codex',
    enabledModelIds: [],
    isDefault: false,
    isDeletable: true,
  })
}

test('subscription reservation validates the connection owner and persists only fenced state', async () => {
  const convex = convexTest(schema, modules)
  const connectionId = await createConnection(convex)
  await expect(convex.mutation(mutation('reserveAuthorization'), {
    serverSecret: secret,
    userId: 'another-owner',
    connectionId,
    providerId: 'codex',
    leaseToken: 'lease-1',
  })).rejects.toThrow(/Subscription connection not found/)

  const reservation = await convex.mutation(mutation('reserveAuthorization'), {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId,
    providerId: 'codex',
    leaseToken: 'lease-1',
  })
  expect(reservation.generation).toBe(1)
  expect(reservation.revision).toBe(1)
  const state = await convex.query(query('getByServer'), {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId,
  })
  expect(state).toMatchObject({
    userId: 'owner-1',
    connectionId,
    providerId: 'codex',
    phase: 'pending',
    leaseToken: 'lease-1',
  })
  expect(state?.credentialRef).toBeUndefined()
  expect(state?.pendingStateRef).toBeUndefined()
})

test('subscription reservation cannot be called without the internal server secret', async () => {
  const convex = convexTest(schema, modules)
  const connectionId = await createConnection(convex)
  await expect(convex.mutation(mutation('reserveAuthorization'), {
    serverSecret: 'wrong',
    userId: 'owner-1',
    connectionId,
    providerId: 'codex',
    leaseToken: 'lease-1',
  })).rejects.toThrow()
})

test('authorization and discovery commits atomically clear their pending Vault write names', async () => {
  let now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const convex = convexTest(schema, modules)
    const connectionId = await createConnection(convex)
    const args = { serverSecret: secret, userId: 'owner-1', connectionId }
    const reservation = await convex.mutation(mutation('reserveAuthorization'), {
      ...args,
      providerId: 'codex',
      leaseToken: 'authorization-lease',
    })
    await convex.mutation(mutation('registerPendingWrite'), { ...args, name: 'pending-authorization' })
    await convex.mutation(mutation('savePendingAuthorization'), {
      ...args,
      generation: reservation.generation,
      revision: reservation.revision,
      leaseToken: 'authorization-lease',
      pendingStateRef: 'vault-pending-state',
      pendingWriteName: 'pending-authorization',
      expiresAt: now + 10 * 60_000,
      pollIntervalMs: 2_000,
    })
    expect((await convex.query(query('getByServer'), args))?.pendingWrites).toEqual([])

    now += 3_000
    const poll = await convex.mutation(mutation('acquirePoll'), {
      ...args,
      leaseToken: 'poll-lease',
    })
    await convex.mutation(mutation('registerPendingWrite'), { ...args, name: 'pending-credential' })
    await convex.mutation(mutation('commitCredentialForDiscovery'), {
      ...args,
      generation: poll.generation!,
      revision: poll.revision!,
      leaseToken: 'poll-lease',
      credentialRef: 'vault-credential',
      pendingWriteName: 'pending-credential',
    })
    expect((await convex.query(query('getByServer'), args))?.pendingWrites).toEqual([])
  } finally {
    clock.mockRestore()
  }
})

test('retainCleanupRef atomically moves a pending write into durable cleanup refs', async () => {
  const convex = convexTest(schema, modules)
  const pending = await createPendingAuthorization(convex)
  const args = {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId: pending.connectionId,
  }
  await convex.mutation(mutation('registerPendingWrite'), { ...args, name: 'orphan-write' })
  await convex.mutation(mutation('retainCleanupRef'), {
    ...args,
    credentialRef: 'vault-orphan',
    pendingWriteName: 'orphan-write',
  })

  const state = await convex.query(query('getByServer'), args)
  expect(state?.pendingWrites).toEqual([])
  expect(state?.cleanupRefs).toContain('vault-orphan')
})

test('disconnect and account forgetting refuse to remove state with pending Vault writes', async () => {
  const convex = convexTest(schema, modules)
  const pending = await createPendingAuthorization(convex)
  const args = {
    serverSecret: secret,
    userId: 'owner-1',
    connectionId: pending.connectionId,
  }
  await convex.mutation(mutation('registerPendingWrite'), { ...args, name: 'orphan-write' })
  await convex.mutation(mutation('disconnect'), args)
  await convex.mutation(mutation('removeCleanupRef'), {
    ...args,
    credentialRef: 'vault-pending-state',
  })

  await expect(convex.mutation(mutation('forgetDisconnectedByServer'), args)).rejects.toThrow(/pending/)
  await expect(convex.mutation(mutation('forgetAllByUser'), {
    serverSecret: secret,
    userId: 'owner-1',
  })).rejects.toThrow(/credentials remain/)
})

test('pending Vault write registration is owner checked and capped at twenty entries', async () => {
  const convex = convexTest(schema, modules)
  const pending = await createPendingAuthorization(convex)
  const args = {
    serverSecret: secret,
    connectionId: pending.connectionId,
  }
  await expect(convex.mutation(mutation('registerPendingWrite'), {
    ...args,
    userId: 'another-owner',
    name: 'wrong-owner-write',
  })).rejects.toThrow(/Subscription connection not found/)

  for (let index = 0; index < 20; index += 1) {
    await convex.mutation(mutation('registerPendingWrite'), {
      ...args,
      userId: 'owner-1',
      name: `pending-${index}`,
    })
  }
  await expect(convex.mutation(mutation('registerPendingWrite'), {
    ...args,
    userId: 'owner-1',
    name: 'pending-21',
  })).rejects.toThrow(/Too many pending/)
})

test('disconnect fences an in-flight poll and retains its vault reference for cleanup', async () => {
  let now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const convex = convexTest(schema, modules)
    const pending = await createPendingAuthorization(convex)
    now += 3_000
    const poll = await convex.mutation(mutation('acquirePoll'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'poll-lease',
    })
    expect(poll.generation).toBe(pending.generation)

    await convex.mutation(mutation('disconnect'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
    })
    await expect(convex.mutation(mutation('commitCredentialForDiscovery'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      generation: poll.generation!,
      revision: poll.revision!,
      leaseToken: 'poll-lease',
      credentialRef: 'vault-credential',
    })).rejects.toThrow()

    const state = await convex.query(query('getByServer'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
    })
    expect(state).toMatchObject({ phase: 'disconnected', cleanupRefs: ['vault-pending-state'] })
    expect(state?.generation).toBeGreaterThan(pending.generation)
  } finally {
    clock.mockRestore()
  }
})

test('discovery activation is atomic and rediscovery preserves an empty model selection', async () => {
  let now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const convex = convexTest(schema, modules)
    const pending = await createPendingAuthorization(convex)
    now += 3_000
    const poll = await convex.mutation(mutation('acquirePoll'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'poll-lease',
    })
    await convex.mutation(mutation('commitCredentialForDiscovery'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      generation: poll.generation!,
      revision: poll.revision!,
      leaseToken: 'poll-lease',
      credentialRef: 'vault-credential',
    })
    const discovery = await convex.mutation(mutation('acquireDiscovery'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'discovery-lease',
    })
    const models = [
      { id: 'codex-one', name: 'Codex One' },
      { id: 'codex-two', name: 'Codex Two' },
    ]
    await convex.mutation(mutation('commitActive'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      generation: discovery.generation!,
      revision: discovery.revision!,
      leaseToken: 'discovery-lease',
      credentialRef: 'vault-credential',
      discoveredModelsJson: JSON.stringify({ data: models }),
      discoveredModelIds: models.map(({ id }) => id),
    })
    const first = await convex.query(connectionQuery('getByServer'), {
      serverSecret: secret,
      connectionId: pending.connectionId,
    })
    expect(first?.status).toBe('active')
    expect(first?.enabledModelIds).toEqual(['codex-one', 'codex-two'])
    const dispatchArgs = {
      serverSecret: secret, userId: 'owner-1',
      connectionId: pending.connectionId, modelId: 'codex-one',
    }
    expect(await convex.query(query('getForDispatchByServer'), dispatchArgs))
      .toMatchObject({ credentialRef: 'vault-credential', providerId: 'codex' })
    expect(await convex.query(query('getForDispatchByServer'), {
      ...dispatchArgs, userId: 'another-owner',
    })).toBeNull()

    await convex.mutation(connectionMutation('updateByServer'), {
      serverSecret: secret,
      connectionId: pending.connectionId,
      enabledModelIds: [],
    })
    expect(await convex.query(query('getForDispatchByServer'), dispatchArgs)).toBeNull()
    const rediscovery = await convex.mutation(mutation('acquireDiscovery'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'rediscovery-lease',
    })
    await convex.mutation(mutation('commitActive'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      generation: rediscovery.generation!,
      revision: rediscovery.revision!,
      leaseToken: 'rediscovery-lease',
      credentialRef: 'vault-credential',
      discoveredModelsJson: JSON.stringify({ data: models }),
      discoveredModelIds: models.map(({ id }) => id),
    })
    const refreshed = await convex.query(connectionQuery('getByServer'), {
      serverSecret: secret,
      connectionId: pending.connectionId,
    })
    expect(refreshed?.status).toBe('active')
    expect(refreshed?.enabledModelIds).toEqual([])

    const refresh = await convex.mutation(mutation('acquireRefresh'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'refresh-lease',
    })
    now += 120_000
    const uncertain = await convex.mutation(mutation('acquireRefresh'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
      leaseToken: 'retry-lease',
    })
    expect(refresh.credentialRef).toBe('vault-credential')
    expect(uncertain.error).toMatch(/uncertain/)
    const failedState = await convex.query(query('getByServer'), {
      serverSecret: secret,
      userId: 'owner-1',
      connectionId: pending.connectionId,
    })
    expect(failedState?.phase).toBe('needs_reconnect')
  } finally {
    clock.mockRestore()
  }
})
