import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'provider-connections-subscription-test-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) =>
  makeFunctionReference<'mutation'>(`providers/connections:${name}`)
const query = (name: string) =>
  makeFunctionReference<'query'>(`providers/connections:${name}`)

const base = {
  serverSecret: secret,
  userId: 'user_1',
  providerId: 'openai',
  endpoint: 'https://api.openai.com/v1',
  displayName: 'OpenAI API key',
  vaultKeyName: 'byok-openai',
  enabledModelIds: [],
  isDefault: false,
  isDeletable: true,
}

test('subscription metadata requires an allowed provider and the empty endpoint sentinel', async () => {
  const convex = convexTest(schema, modules)

  await expect(convex.mutation(mutation('createByServer'), {
    ...base,
    providerId: 'subscription:codex',
  })).rejects.toThrow(/Invalid subscription connection metadata/)
  await expect(convex.mutation(mutation('createByServer'), {
    ...base,
    providerId: 'subscription:codex',
    authKind: 'subscription',
    subscriptionProvider: 'codex',
  })).rejects.toThrow(/Invalid subscription connection metadata/)
  await expect(convex.mutation(mutation('createByServer'), {
    ...base,
    providerId: 'subscription:anthropic',
    authKind: 'subscription',
    subscriptionProvider: 'anthropic',
    endpoint: '',
  })).rejects.toThrow()

  const connectionId = await convex.mutation(mutation('createByServer'), {
    ...base,
    providerId: 'subscription:codex',
    authKind: 'subscription',
    subscriptionProvider: 'codex',
    endpoint: '',
  })
  const connection = await convex.query(query('getByServer'), {
    serverSecret: secret,
    connectionId,
  })
  expect(connection).toMatchObject({
    authKind: 'subscription',
    subscriptionProvider: 'codex',
    endpoint: '',
    status: 'untested',
  })
  expect(connection?.vaultObjectId).toBeUndefined()
})

test('server mutations cannot forge subscription metadata on an existing connection', async () => {
  const convex = convexTest(schema, modules)
  const connectionId = await convex.mutation(mutation('createByServer'), base)

  await expect(convex.mutation(mutation('updateByServer'), {
    serverSecret: secret,
    connectionId,
    authKind: 'subscription',
    subscriptionProvider: 'codex',
  })).rejects.toThrow(/Subscription identity cannot be changed/)
})
