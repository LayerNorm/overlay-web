import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fromSdkTokens,
  McpOAuthInteractionRequiredError,
  McpOAuthProvider,
  toSdkTokens,
} from './McpOAuthProvider'
import type { McpOAuthTokens, McpServerRepository } from './McpServerRepository'

type OAuthStateArgs = Parameters<McpServerRepository['updateOAuthState']>[0]

function fakeRepository(overrides: Partial<McpServerRepository> = {}) {
  const calls: OAuthStateArgs[] = []
  const repository = {
    calls,
    updateOAuthState: async (args: OAuthStateArgs) => {
      calls.push(args)
      return true
    },
    ...overrides,
  } as unknown as McpServerRepository & { calls: OAuthStateArgs[] }
  return repository
}

function provider(repository: McpServerRepository, options: Record<string, unknown> = {}) {
  return new McpOAuthProvider({
    mcpServerId: 'mcp_1',
    redirectUri: 'https://www.getoverlay.io/api/v1/mcps/oauth/callback',
    repository,
    serverName: 'Monid',
    userId: 'user_1',
    ...options,
  })
}

test('a runtime refresh that needs a human fails loudly and flags the server', async () => {
  const repository = fakeRepository()
  const subject = provider(repository)

  await assert.rejects(
    () => subject.redirectToAuthorization(new URL('https://auth.monid.ai/authorize')),
    (error: Error) =>
      error instanceof McpOAuthInteractionRequiredError &&
      error.message.includes('Monid') &&
      error.message.includes('reconnected'),
  )

  const flagged = (repository as unknown as { calls: OAuthStateArgs[] }).calls.at(-1)
  assert.equal(flagged?.status, 'needs_reauth')
  assert.equal(flagged?.mcpServerId, 'mcp_1')
})

test('an interactive flow captures the authorization URL instead of throwing', async () => {
  const repository = fakeRepository()
  const seen: URL[] = []
  const subject = provider(repository, { onRedirect: (url: URL) => { seen.push(url) } })

  await subject.redirectToAuthorization(new URL('https://auth.monid.ai/authorize?x=1'))

  assert.equal(seen.length, 1)
  assert.equal(subject.authorizationUrl?.host, 'auth.monid.ai')
  assert.equal((repository as unknown as { calls: OAuthStateArgs[] }).calls.length, 0)
})

test('state() returns the stored session id so the callback can correlate the flow', () => {
  const subject = provider(fakeRepository(), { stateValue: 'session-handle-abc' })
  assert.equal(subject.state(), 'session-handle-abc')
  assert.throws(() => provider(fakeRepository()).state(), /No OAuth state/)
})

test('losing the token compare-and-set adopts the winner rather than clobbering it', async () => {
  const winner: McpOAuthTokens = { accessToken: 'winner-access', refreshToken: 'winner-refresh' }
  const repository = fakeRepository({
    get: async () => ({ oauthTokenVersion: 9, oauthTokens: winner }) as never,
    updateOAuthState: async () => false,
  })
  const subject = provider(repository, {
    initialTokenVersion: 3,
    initialTokens: { accessToken: 'stale', refreshToken: 'stale-refresh' },
  })

  await subject.saveTokens({ access_token: 'loser-access', refresh_token: 'loser-refresh' })

  // The provider must now serve the winner's tokens, not the ones it just tried to write.
  assert.equal(subject.tokens()?.access_token, 'winner-access')
})

test('winning the compare-and-set advances the version for the next write', async () => {
  const repository = fakeRepository()
  const subject = provider(repository, { initialTokenVersion: 4 })

  await subject.saveTokens({ access_token: 'a1' })
  await subject.saveTokens({ access_token: 'a2' })

  const versions = (repository as unknown as { calls: OAuthStateArgs[] }).calls
    .map((call) => call.expectedTokenVersion)
  assert.deepEqual(versions, [4, 5])
  assert.equal(subject.tokens()?.access_token, 'a2')
})

test('DCR results are stored with the client secret sealed alongside the id', async () => {
  const repository = fakeRepository()
  const subject = provider(repository)

  await subject.saveClientInformation({ client_id: 'cid', client_secret: 'csecret' })

  const saved = (repository as unknown as { calls: OAuthStateArgs[] }).calls.at(-1)
  assert.deepEqual(saved?.client, { clientId: 'cid', clientSecret: 'csecret', registered: true })
  assert.equal(subject.clientInformation()?.client_id, 'cid')
})

test('token shape converts between relative expires_in and absolute expiry', () => {
  const absolute = fromSdkTokens({ access_token: 'a', expires_in: 120 })
  assert.ok(absolute.expiresAt && absolute.expiresAt > Date.now() + 110_000)

  const roundTripped = toSdkTokens({ accessToken: 'a', expiresAt: Date.now() + 60_000 })
  assert.ok(roundTripped.expires_in && roundTripped.expires_in <= 60)
  assert.equal(roundTripped.token_type, 'Bearer')

  // Non-expiring tokens must not gain a bogus expires_in.
  assert.equal(toSdkTokens({ accessToken: 'a' }).expires_in, undefined)
})

test('the redirect URI is fixed so DCR registrations stay valid across surfaces', () => {
  const subject = provider(fakeRepository())
  assert.equal(subject.redirectUrl, 'https://www.getoverlay.io/api/v1/mcps/oauth/callback')
  assert.deepEqual(subject.clientMetadata.redirect_uris, [subject.redirectUrl])
  assert.deepEqual(subject.clientMetadata.grant_types, ['authorization_code', 'refresh_token'])
})

test('a PKCE verifier is refused when no session is backing the flow', async () => {
  const subject = provider(fakeRepository())
  await assert.rejects(() => subject.saveCodeVerifier('verifier'), /No MCP OAuth session/)
  assert.throws(() => subject.codeVerifier(), /No PKCE verifier/)
})
