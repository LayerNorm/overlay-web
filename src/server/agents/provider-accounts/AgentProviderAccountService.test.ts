import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentProviderAccountError, AgentProviderAccountService } from './AgentProviderAccountService'
import type { AgentProviderAccountRecord, AgentProviderAccountRepository } from './AgentProviderAccountRepository'
import { parseCodexTokens, serializeCodexTokens, type CodexFetch, type CodexTokenSet } from './codex-subscription'

const CLAUDE_TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40)
const CLAUDE_KEY = 'sk-ant-api03-' + 'b'.repeat(40)
const OPENAI_KEY = 'sk-' + 'c'.repeat(40)

function harness(options: { fetchStatus?: number; fetchThrows?: boolean; createThrows?: string; codexFetch?: CodexFetch; lockHeldBy?: string; nowRef?: { value: number } } = {}) {
  const locks = new Map<string, { owner: string; until: number }>()
  if (options.lockHeldBy) locks.set('acct-1', { owner: options.lockHeldBy, until: Number.MAX_SAFE_INTEGER })
  const sleeps: number[] = []
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
    acquireRefreshLock: async ({ accountId, owner, ttlMs, now }) => {
      const held = locks.get(accountId)
      if (held && held.until > now && held.owner !== owner) return false
      locks.set(accountId, { owner, until: now + ttlMs })
      return true
    },
    releaseRefreshLock: async ({ accountId, owner }) => { if (locks.get(accountId)?.owner === owner) locks.delete(accountId) },
    remove: async ({ accountId }) => { rows.delete(accountId) },
    listCredentialRefs: async ({ userId }) => [...rows.values()].filter((row) => row.userId === userId).map((row) => row.credentialRef),
  }
  const store = {
    write: async ({ apiKey }: { apiKey: string }) => { const ref = `ref-${vault.size + 1}`; vault.set(ref, apiKey); return ref },
    read: async (ref: string) => vault.get(ref) ?? null,
    update: async ({ credentialRef, apiKey }: { credentialRef: string; apiKey: string }) => { vault.set(credentialRef, apiKey) },
    delete: async (ref: string) => { vault.delete(ref) },
  }
  const service = new AgentProviderAccountService({
    repository, store, audit: { record: async (event: { action: string }) => { audit.push(event.action) } } as never,
    now: () => options.nowRef?.value ?? 5_000,
    ...(options.codexFetch ? { codexFetch: options.codexFetch } : {}),
    sleep: async (ms) => { sleeps.push(ms); if (options.nowRef) options.nowRef.value += ms },
    fetch: async (url) => {
      verifyCalls.push(url)
      if (options.fetchThrows) throw new Error('offline')
      return { status: options.fetchStatus ?? 200 }
    },
  })
  return { service, rows, vault, verifyCalls, audit, locks, sleeps }
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
  await assert.rejects(service.connect({ userId: 'u1', provider: 'codex', method: 'subscription', secret: OPENAI_KEY }), /Sign in with ChatGPT/)
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

// ---- Codex with a ChatGPT subscription ----

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const CLOCK = 1_900_000_000_000
const ID_TOKEN = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-x', chatgpt_plan_type: 'pro' } })
const accessExpiringIn = (ms: number) => jwt({ exp: Math.floor((CLOCK + ms) / 1000) })
const codexTokens = (overrides: Partial<CodexTokenSet> = {}): CodexTokenSet => ({
  v: 1, idToken: ID_TOKEN, accessToken: accessExpiringIn(2 * 60 * 60_000), refreshToken: 'refresh-A', accountId: 'acct-x', lastRefresh: CLOCK, plan: 'pro', ...overrides,
})

function fakeOpenAi(handlers: { poll?: () => { status: number; body?: unknown }; refresh?: () => { status: number; body?: unknown } }) {
  const refreshBodies: string[] = []
  const fetch: CodexFetch = async (url, init) => {
    let result: { status: number; body?: unknown }
    if (url.endsWith('/deviceauth/usercode')) result = { status: 200, body: { device_auth_id: 'dev-1', user_code: 'CODE-1', interval: '5' } }
    else if (url.endsWith('/deviceauth/token')) result = handlers.poll?.() ?? { status: 403 }
    else if (init.headers['content-type'] === 'application/json') { refreshBodies.push(init.body); result = handlers.refresh?.() ?? { status: 503 } }
    else result = { status: 200, body: { id_token: ID_TOKEN, access_token: accessExpiringIn(2 * 60 * 60_000), refresh_token: 'refresh-A' } }
    return { status: result.status, text: async () => JSON.stringify(result.body ?? {}) }
  }
  return { fetch, refreshBodies }
}

async function connectedCodex(overrides: Parameters<typeof harness>[0] = {}) {
  const nowRef = { value: CLOCK }
  const openai = fakeOpenAi({ poll: () => ({ status: 200, body: { authorization_code: 'c', code_challenge: 'x', code_verifier: 'v' } }) })
  const h = harness({ ...overrides, nowRef, codexFetch: overrides.codexFetch ?? openai.fetch })
  const result = await h.service.completeCodexSignIn({ userId: 'u1', deviceAuthId: 'dev-1', userCode: 'CODE-1' })
  assert.equal(result.status, 'connected')
  return { ...h, nowRef, account: (result as { account: { id: string } }).account }
}

test('signing in to Codex shows a code, reports pending until approved, then stores the tokens in the vault as a labelled account', async () => {
  const waiting = harness({ codexFetch: fakeOpenAi({}).fetch })
  const code = await waiting.service.startCodexSignIn()
  assert.equal(code.userCode, 'CODE-1')
  assert.deepEqual(await waiting.service.completeCodexSignIn({ userId: 'u1', deviceAuthId: 'dev-1', userCode: 'CODE-1' }), { status: 'pending' })
  assert.equal(waiting.vault.size, 0)

  const { rows, vault, account } = await connectedCodex()
  assert.equal(account.id, 'acct-1')
  const row = rows.get('acct-1')!
  assert.equal(row.provider, 'codex')
  assert.equal(row.method, 'subscription')
  assert.equal(row.label, 'Codex (ChatGPT Pro)')
  assert.equal(parseCodexTokens([...vault.values()][0]!)?.refreshToken, 'refresh-A')
  assert.equal(JSON.stringify(row).includes('refresh-A'), false, 'the account row never holds a token')
})

test('a run gets an auth.json with fresh short-lived tokens, never the refresh token, and no environment variable', async () => {
  const { service, rows } = await connectedCodex()
  const run = await service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' })
  assert.deepEqual(run.env, {})
  assert.equal(run.files.length, 1)
  assert.equal(run.files[0]!.path, '/home/user/.codex/auth.json')
  assert.ok(!run.files[0]!.contents.includes('refresh-A'))
  assert.match(run.files[0]!.contents, /"auth_mode": "chatgpt"/)
  assert.ok(rows.get('acct-1')!.lastUsedAt)
})

test('tokens near their end are refreshed under the lock, the new refresh token is stored first, and the lock is released', async () => {
  const refreshed = fakeOpenAi({ refresh: () => ({ status: 200, body: { access_token: accessExpiringIn(2 * 60 * 60_000), refresh_token: 'refresh-B' } }) })
  const { service, vault, locks, nowRef } = await connectedCodex({ codexFetch: undefined })
  // Replace the stored tokens with ones about to expire, and point the service at an OpenAI that refreshes.
  const [ref] = [...vault.keys()]
  vault.set(ref!, serializeCodexTokens(codexTokens({ accessToken: accessExpiringIn(5 * 60_000) })))
  const h2 = harness({ nowRef, codexFetch: refreshed.fetch })
  h2.rows.set('acct-1', { id: 'acct-1', userId: 'u1', provider: 'codex', method: 'subscription', label: 'c', credentialRef: ref!, status: 'active', createdAt: 1, updatedAt: 1 })
  h2.vault.set(ref!, vault.get(ref!)!)
  const run = await h2.service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' })
  assert.equal(refreshed.refreshBodies.length, 1)
  assert.equal(JSON.parse(refreshed.refreshBodies[0]!).refresh_token, 'refresh-A')
  assert.equal(parseCodexTokens(h2.vault.get(ref!)!)?.refreshToken, 'refresh-B', 'the rotated token is what the vault holds')
  assert.equal(h2.locks.size, 0, 'the lock is released')
  assert.ok(!run.files[0]!.contents.includes('refresh-B'))
  void service; void locks
})

test('while another server holds the refresh lock this one waits, reads what it stored, and does not refresh', async () => {
  const neverRefresh = fakeOpenAi({ refresh: () => { throw new Error('must not refresh') } })
  const nowRef = { value: CLOCK }
  const h = harness({ nowRef, codexFetch: neverRefresh.fetch, lockHeldBy: 'other-server' })
  const ref = 'ref-1'
  h.rows.set('acct-1', { id: 'acct-1', userId: 'u1', provider: 'codex', method: 'subscription', label: 'c', credentialRef: ref, status: 'active', createdAt: 1, updatedAt: 1 })
  h.vault.set(ref, serializeCodexTokens(codexTokens({ accessToken: accessExpiringIn(5 * 60_000) })))
  // The other server finishes during our wait.
  const original = h.sleeps.push.bind(h.sleeps)
  h.sleeps.push = (...items: number[]) => { h.vault.set(ref, serializeCodexTokens(codexTokens({ refreshToken: 'refresh-B' }))); return original(...items) }
  const run = await h.service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' })
  assert.equal(neverRefresh.refreshBodies.length, 0)
  assert.equal(run.files.length, 1)
  assert.ok(h.sleeps.length >= 1)
})

test('if the lock is never freed the run says to try again, without refreshing', async () => {
  const nowRef = { value: CLOCK }
  const h = harness({ nowRef, codexFetch: fakeOpenAi({}).fetch, lockHeldBy: 'other-server' })
  h.rows.set('acct-1', { id: 'acct-1', userId: 'u1', provider: 'codex', method: 'subscription', label: 'c', credentialRef: 'ref-1', status: 'active', createdAt: 1, updatedAt: 1 })
  h.vault.set('ref-1', serializeCodexTokens(codexTokens({ accessToken: accessExpiringIn(60_000) })))
  await assert.rejects(
    h.service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' }),
    (error: AgentProviderAccountError) => error.code === 'account_refreshing',
  )
})

test('a refresh token ChatGPT rejects flags the account for reconnecting; an outage does not', async () => {
  const setupAccount = (fetcher: CodexFetch) => {
    const h = harness({ nowRef: { value: CLOCK }, codexFetch: fetcher })
    h.rows.set('acct-1', { id: 'acct-1', userId: 'u1', provider: 'codex', method: 'subscription', label: 'c', credentialRef: 'ref-1', status: 'active', createdAt: 1, updatedAt: 1 })
    h.vault.set('ref-1', serializeCodexTokens(codexTokens({ accessToken: accessExpiringIn(60_000) })))
    return h
  }
  const revoked = setupAccount(fakeOpenAi({ refresh: () => ({ status: 400, body: { error: 'invalid_grant' } }) }).fetch)
  await assert.rejects(revoked.service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' }), (error: AgentProviderAccountError) => error.code === 'account_needs_reauth')
  assert.equal(revoked.rows.get('acct-1')!.status, 'needs_reauth')
  assert.equal(revoked.locks.size, 0)

  const outage = setupAccount(fakeOpenAi({ refresh: () => ({ status: 503 }) }).fetch)
  await assert.rejects(outage.service.resolveRunEnvironment({ accountId: 'acct-1', ownerUserId: 'u1', expectedProvider: 'codex' }), (error: AgentProviderAccountError) => error.code === 'codex_transient')
  assert.equal(outage.rows.get('acct-1')!.status, 'active', 'an outage must not make the person sign in again')
  assert.equal(outage.locks.size, 0)
})

test('signing in again replaces the tokens of the account being reconnected and clears its error', async () => {
  const { service, rows, vault } = await connectedCodex()
  await service.markNeedsReauth('acct-1', 'rejected')
  const [ref] = [...vault.keys()]
  vault.set(ref!, serializeCodexTokens(codexTokens({ refreshToken: 'stale' })))
  const result = await service.completeCodexSignIn({ userId: 'u1', deviceAuthId: 'dev-1', userCode: 'CODE-1', accountId: 'acct-1' })
  assert.equal(result.status, 'connected')
  assert.equal(rows.get('acct-1')!.status, 'active')
  assert.equal(parseCodexTokens(vault.get(ref!)!)?.refreshToken, 'refresh-A')
  await assert.rejects(service.completeCodexSignIn({ userId: 'someone-else', deviceAuthId: 'd', userCode: 'u', accountId: 'acct-1' }), /not found/i)
})
