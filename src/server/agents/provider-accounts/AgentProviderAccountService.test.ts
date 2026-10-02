import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentProviderAccountError, AgentProviderAccountService } from './AgentProviderAccountService'
import type { AgentProviderAccountRecord, AgentProviderAccountRepository } from './AgentProviderAccountRepository'

const CLAUDE_TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40)
const CLAUDE_KEY = 'sk-ant-api03-' + 'b'.repeat(40)
const OPENAI_KEY = 'sk-' + 'c'.repeat(40)

function harness(options: { fetchStatus?: number; fetchThrows?: boolean; createThrows?: string } = {}) {
  const rows = new Map<string, AgentProviderAccountRecord>()
  const vault = new Map<string, string>()
  const verifyCalls: string[] = []
  const audit: string[] = []
  let counter = 0
  const repository: AgentProviderAccountRepository = {
    listPublic: async ({ userId }) => [...rows.values()].filter((row) => row.userId === userId)
      .map(({ userId: _u, credentialRef: _c, ...publicRow }) => publicRow),
    get: async ({ accountId }) => rows.get(accountId) ?? null,
    create: async (args) => {
      if (options.createThrows) throw new Error(options.createThrows)
      const id = `acct-${++counter}`
      rows.set(id, { id, userId: args.userId, provider: args.provider, method: args.method, label: args.label,
        credentialRef: args.credentialRef, status: 'active', createdAt: 1, updatedAt: 1 })
      return id
    },
    update: async ({ accountId, lastError, ...patch }) => {
      const row = rows.get(accountId)
      if (!row) throw new Error('missing')
      Object.assign(row, patch, lastError === undefined ? {} : { lastError: lastError ?? undefined })
    },
    remove: async ({ accountId }) => { rows.delete(accountId) },
  }
  const store = {
    write: async ({ apiKey }: { apiKey: string }) => { const ref = `ref-${vault.size + 1}`; vault.set(ref, apiKey); return ref },
    read: async (ref: string) => vault.get(ref) ?? null,
    update: async ({ credentialRef, apiKey }: { credentialRef: string; apiKey: string }) => { vault.set(credentialRef, apiKey) },
    delete: async (ref: string) => { vault.delete(ref) },
  }
  const service = new AgentProviderAccountService({
    repository, store, audit: { record: async (event: { action: string }) => { audit.push(event.action) } } as never,
    now: () => 5_000,
    fetch: async (url) => {
      verifyCalls.push(url)
      if (options.fetchThrows) throw new Error('offline')
      return { status: options.fetchStatus ?? 200 }
    },
  })
  return { service, rows, vault, verifyCalls, audit }
}

test('connect stores the secret in the vault only, and the public account never carries it', async () => {
  const { service, rows, vault } = harness()
  const account = await service.connect({ userId: 'u1', provider: 'claude-code', method: 'subscription', secret: `  ${CLAUDE_TOKEN}\n` })
  assert.equal(account.provider, 'claude-code')
  assert.equal(account.label, 'Claude Code subscription')
  assert.equal(account.status, 'active')
  assert.equal(JSON.stringify(account).includes(CLAUDE_TOKEN), false)
  assert.equal(JSON.stringify([...rows.values()]).includes(CLAUDE_TOKEN), false)
  assert.deepEqual([...vault.values()], [CLAUDE_TOKEN])
  assert.equal('credentialRef' in account, false)
})

test('connect refuses mismatched or malformed credentials before touching the vault', async () => {
  const { service, vault } = harness()
  await assert.rejects(service.connect({ userId: 'u1', provider: 'claude-code', method: 'subscription', secret: CLAUDE_KEY }), /API key/)
  await assert.rejects(service.connect({ userId: 'u1', provider: 'claude-code', method: 'api_key', secret: CLAUDE_TOKEN }), /subscription/)
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: CLAUDE_KEY }), /Anthropic/)
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'subscription', secret: OPENAI_KEY }), /sign-in method/)
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: 'two words' }), /single line/)
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: 'short' }), /too short/)
  assert.equal(vault.size, 0)
})

test('API keys are verified with the vendor; a rejected key is not stored, an unreachable vendor is not fatal', async () => {
  const rejected = harness({ fetchStatus: 401 })
  await assert.rejects(rejected.service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY }), /rejected/)
  assert.equal(rejected.vault.size, 0)
  assert.match(rejected.verifyCalls[0] ?? '', /api\.openai\.com/)

  const offline = harness({ fetchThrows: true })
  const account = await offline.service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY })
  assert.equal(account.status, 'active')

  const subscription = harness()
  await subscription.service.connect({ userId: 'u1', provider: 'claude-code', method: 'subscription', secret: CLAUDE_TOKEN })
  assert.deepEqual(subscription.verifyCalls, [], 'subscription tokens have no public check')
})

test('a failed database write does not leave an orphaned secret', async () => {
  const { service, vault } = harness({ createThrows: 'AGENT_PROVIDER_ACCOUNT_LIMIT' })
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY }), /limit/)
  assert.equal(vault.size, 0)
})

test('accounts are private: another user cannot reconnect, rename, remove, or run on them', async () => {
  const { service } = harness()
  const account = await service.connect({ userId: 'u1', provider: 'claude-code', method: 'api_key', secret: CLAUDE_KEY })
  await assert.rejects(service.reconnect({ userId: 'u2', accountId: account.id, secret: CLAUDE_KEY }), /not found/)
  await assert.rejects(service.rename({ userId: 'u2', accountId: account.id, label: 'x' }), /not found/)
  await assert.rejects(service.remove({ userId: 'u2', accountId: account.id }), /not found/)
  await assert.rejects(service.resolveRunEnvironment({ accountId: account.id, ownerUserId: 'u2', expectedProvider: 'claude-code' }), /no usable account/)
  await assert.rejects(service.requireUsable({ userId: 'u1', accountId: account.id, provider: 'codex' }), /different agent/)
  assert.equal((await service.requireUsable({ userId: 'u1', accountId: account.id, provider: 'claude-code' })).id, account.id)
})

test('a run gets the right environment variable for the account, and use is recorded', async () => {
  const { service, rows } = harness()
  const subscription = await service.connect({ userId: 'u1', provider: 'claude-code', method: 'subscription', secret: CLAUDE_TOKEN })
  const key = await service.connect({ userId: 'u1', provider: 'claude-code', method: 'api_key', secret: CLAUDE_KEY })
  const codex = await service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY })
  assert.deepEqual((await service.resolveRunEnvironment({ accountId: subscription.id, ownerUserId: 'u1', expectedProvider: 'claude-code' })).env,
    { CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN })
  assert.deepEqual((await service.resolveRunEnvironment({ accountId: key.id, ownerUserId: 'u1', expectedProvider: 'claude-code' })).env,
    { ANTHROPIC_API_KEY: CLAUDE_KEY })
  assert.deepEqual((await service.resolveRunEnvironment({ accountId: codex.id, ownerUserId: 'u1', expectedProvider: 'codex' })).env,
    { OPENAI_API_KEY: OPENAI_KEY })
  assert.equal(rows.get(codex.id)?.lastUsedAt, 5_000)
})

test('a flagged account releases nothing until it is reconnected, and reconnecting clears the flag', async () => {
  const { service, rows, vault } = harness()
  const account = await service.connect({ userId: 'u1', provider: 'claude-code', method: 'subscription', secret: CLAUDE_TOKEN })
  await service.markNeedsReauth(account.id, 'sign-in failed')
  assert.equal(rows.get(account.id)?.status, 'needs_reauth')
  await assert.rejects(
    service.resolveRunEnvironment({ accountId: account.id, ownerUserId: 'u1', expectedProvider: 'claude-code' }),
    (error: unknown) => error instanceof AgentProviderAccountError && error.code === 'account_needs_reauth',
  )
  const fresh = 'sk-ant-oat01-' + 'z'.repeat(40)
  const updated = await service.reconnect({ userId: 'u1', accountId: account.id, secret: fresh })
  assert.equal(updated.status, 'active')
  assert.equal(rows.get(account.id)?.lastError, undefined)
  assert.deepEqual([...vault.values()], [fresh])
  assert.deepEqual((await service.resolveRunEnvironment({ accountId: account.id, ownerUserId: 'u1', expectedProvider: 'claude-code' })).env,
    { CLAUDE_CODE_OAUTH_TOKEN: fresh })
})

test('a vault entry that has gone missing flags the account instead of running without it', async () => {
  const { service, rows, vault } = harness()
  const account = await service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY })
  vault.clear()
  await assert.rejects(service.resolveRunEnvironment({ accountId: account.id, ownerUserId: 'u1', expectedProvider: 'codex' }), /Reconnect/)
  assert.equal(rows.get(account.id)?.status, 'needs_reauth')
})

test('remove deletes the vault secret first, then the account', async () => {
  const { service, rows, vault, audit } = harness()
  const account = await service.connect({ userId: 'u1', provider: 'codex', method: 'api_key', secret: OPENAI_KEY })
  await service.remove({ userId: 'u1', accountId: account.id })
  assert.equal(vault.size, 0)
  assert.equal(rows.size, 0)
  assert.deepEqual(audit, ['agent_provider_account.connected', 'agent_provider_account.removed'])
})
