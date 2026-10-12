import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CODEX_CLIENT_ID,
  CodexSignInError,
  codexAccessTokenExpiry,
  codexAuthJsonForMachine,
  codexTokensNeedRefresh,
  parseCodexTokens,
  pollCodexDeviceCode,
  refreshCodexTokens,
  requestCodexDeviceCode,
  serializeCodexTokens,
  type CodexFetch,
  type CodexTokenSet,
} from './codex-subscription'

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const NOW = 1_900_000_000_000
const idToken = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' } })
const accessToken = (expiresInMs: number) => jwt({ exp: Math.floor((NOW + expiresInMs) / 1000) })

type Call = { url: string; method: string; headers: Record<string, string>; body: string }
function fakeOpenAi(handler: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = []
  const fetch: CodexFetch = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body }
    calls.push(call)
    const result = handler(call)
    return { status: result.status, text: async () => JSON.stringify(result.body ?? {}) }
  }
  return { fetch, calls }
}

const tokens = (overrides: Partial<CodexTokenSet> = {}): CodexTokenSet => ({
  v: 1, idToken, accessToken: accessToken(60 * 60_000), refreshToken: 'refresh-1', accountId: 'acct-1', lastRefresh: NOW, plan: 'plus', ...overrides,
})

test('a sign-in starts with a one-time code and the link to enter it at', async () => {
  const openai = fakeOpenAi(() => ({ status: 200, body: { device_auth_id: 'dev-1', user_code: 'ABCD-1234', interval: '5' } }))
  const code = await requestCodexDeviceCode({ fetch: openai.fetch, now: () => NOW })
  assert.equal(code.deviceAuthId, 'dev-1')
  assert.equal(code.userCode, 'ABCD-1234')
  assert.equal(code.verificationUrl, 'https://auth.openai.com/codex/device')
  assert.equal(code.interval, 5)
  assert.equal(code.expiresAt, NOW + 15 * 60_000)
  assert.equal(openai.calls[0]!.url, 'https://auth.openai.com/api/accounts/deviceauth/usercode')
  assert.deepEqual(JSON.parse(openai.calls[0]!.body), { client_id: CODEX_CLIENT_ID })
})

test('while the person has not approved, polling reports pending; once they have, the code is exchanged for tokens', async () => {
  const pending = fakeOpenAi(() => ({ status: 403 }))
  await assert.rejects(pollCodexDeviceCode({ deviceAuthId: 'd', userCode: 'u' }, { fetch: pending.fetch }), (error: CodexSignInError) => error.code === 'pending')
  const notFound = fakeOpenAi(() => ({ status: 404 }))
  await assert.rejects(pollCodexDeviceCode({ deviceAuthId: 'd', userCode: 'u' }, { fetch: notFound.fetch }), (error: CodexSignInError) => error.code === 'pending')

  const approved = fakeOpenAi((call) => call.url.endsWith('/deviceauth/token')
    ? { status: 200, body: { authorization_code: 'code-1', code_challenge: 'c', code_verifier: 'verifier-1' } }
    : { status: 200, body: { id_token: idToken, access_token: accessToken(3_600_000), refresh_token: 'refresh-1' } })
  const result = await pollCodexDeviceCode({ deviceAuthId: 'dev-1', userCode: 'ABCD-1234' }, { fetch: approved.fetch, now: () => NOW })
  assert.equal(result.refreshToken, 'refresh-1')
  assert.equal(result.accountId, 'acct-1')
  assert.equal(result.plan, 'plus')
  assert.equal(result.lastRefresh, NOW)
  const exchange = approved.calls[1]!
  assert.equal(exchange.url, 'https://auth.openai.com/oauth/token')
  assert.equal(exchange.headers['content-type'], 'application/x-www-form-urlencoded')
  const form = new URLSearchParams(exchange.body)
  assert.equal(form.get('grant_type'), 'authorization_code')
  assert.equal(form.get('code'), 'code-1')
  assert.equal(form.get('code_verifier'), 'verifier-1')
  assert.equal(form.get('client_id'), CODEX_CLIENT_ID)
  assert.equal(form.get('redirect_uri'), 'https://auth.openai.com/deviceauth/callback')
})

test('a refused or unreachable sign-in is an error, not "pending"', async () => {
  const denied = fakeOpenAi(() => ({ status: 400 }))
  await assert.rejects(pollCodexDeviceCode({ deviceAuthId: 'd', userCode: 'u' }, { fetch: denied.fetch }), (error: CodexSignInError) => error.code === 'denied')
  const down: CodexFetch = async () => { throw new Error('network') }
  await assert.rejects(requestCodexDeviceCode({ fetch: down }), (error: CodexSignInError) => error.code === 'transient')
  const unsupported = fakeOpenAi(() => ({ status: 404 }))
  await assert.rejects(requestCodexDeviceCode({ fetch: unsupported.fetch }), (error: CodexSignInError) => error.code === 'unsupported')
})

test('a refresh rotates the refresh token and keeps what the response leaves out', async () => {
  const openai = fakeOpenAi(() => ({ status: 200, body: { access_token: accessToken(3_600_000), refresh_token: 'refresh-2' } }))
  const next = await refreshCodexTokens(tokens(), { fetch: openai.fetch, now: () => NOW + 1_000 })
  assert.equal(next.refreshToken, 'refresh-2')
  assert.equal(next.idToken, idToken, 'an id token the refresh did not send is kept')
  assert.equal(next.accountId, 'acct-1')
  assert.equal(next.lastRefresh, NOW + 1_000)
  assert.equal(openai.calls[0]!.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(openai.calls[0]!.body), { client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'refresh-1' })
})

test('a refresh token OpenAI rejects is permanent; a server error is not', async () => {
  const revoked = fakeOpenAi(() => ({ status: 400, body: { error: 'invalid_grant' } }))
  await assert.rejects(refreshCodexTokens(tokens(), { fetch: revoked.fetch }), (error: CodexSignInError) => error.code === 'rejected')
  const unauthorized = fakeOpenAi(() => ({ status: 401, body: { error: { code: 'refresh_token_reused' } } }))
  await assert.rejects(refreshCodexTokens(tokens(), { fetch: unauthorized.fetch }), (error: CodexSignInError) => error.code === 'rejected')
  const broken = fakeOpenAi(() => ({ status: 503 }))
  await assert.rejects(refreshCodexTokens(tokens(), { fetch: broken.fetch }), (error: CodexSignInError) => error.code === 'transient')
})

test('tokens are refreshed when the access token is near its end, and an unreadable expiry reads as "refresh now"', () => {
  assert.equal(codexTokensNeedRefresh(tokens({ accessToken: accessToken(3 * 60 * 60_000) }), NOW), false)
  assert.equal(codexTokensNeedRefresh(tokens({ accessToken: accessToken(10 * 60_000) }), NOW), true)
  assert.equal(codexAccessTokenExpiry(tokens({ accessToken: 'not-a-jwt' })), 0)
  assert.equal(codexTokensNeedRefresh(tokens({ accessToken: 'not-a-jwt' }), NOW), true)
})

test('the file a machine gets has the short-lived tokens and never the real refresh token', () => {
  const file = JSON.parse(codexAuthJsonForMachine(tokens({ refreshToken: 'real-secret-refresh' })))
  assert.equal(file.auth_mode, 'chatgpt')
  assert.equal(file.OPENAI_API_KEY, null)
  assert.equal(file.tokens.access_token.length > 10, true)
  assert.equal(file.tokens.account_id, 'acct-1')
  assert.notEqual(file.tokens.refresh_token, 'real-secret-refresh')
  assert.ok(!JSON.stringify(file).includes('real-secret-refresh'))
  assert.equal(file.last_refresh, new Date(NOW).toISOString())
})

test('stored tokens round trip, and anything else is not a token set', () => {
  assert.deepEqual(parseCodexTokens(serializeCodexTokens(tokens())), tokens())
  assert.equal(parseCodexTokens('sk-proj-an-api-key'), null)
  assert.equal(parseCodexTokens(JSON.stringify({ v: 2 })), null)
})
