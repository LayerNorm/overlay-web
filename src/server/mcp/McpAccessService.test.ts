import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { McpAccessService, McpOAuthError } from './McpAccessService'
import type { McpGrantRecord, McpGrantRepository } from './McpGrantRepository'

process.env.INTERNAL_API_SECRET = 'test-secret-for-mcp-service'

function memoryGrants(): McpGrantRepository & { rows: Map<string, McpGrantRecord & { codeId?: string }> } {
  const rows = new Map<string, McpGrantRecord & { codeId?: string }>()
  let next = 0
  return {
    rows,
    get: async ({ grantId }) => rows.get(grantId) ?? null,
    listActive: async ({ userId }) => [...rows.values()].filter((row) => row.userId === userId && row.revokedAt === undefined),
    create: async (args) => {
      if (args.codeId) {
        const used = [...rows.values()].find((row) => row.codeId === args.codeId)
        if (used) { used.revokedAt = args.now; return { ok: false, reason: 'code_already_used' } }
      }
      const id = `grant-${++next}`
      rows.set(id, { id, userId: args.userId, workspaceId: args.workspaceId, access: args.access, kind: args.kind, clientName: args.clientName,
        ...(args.clientId ? { clientId: args.clientId } : {}), ...(args.codeId ? { codeId: args.codeId } : {}), refreshVersion: 0, createdAt: args.now,
        ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}) })
      return { ok: true, id }
    },
    touch: async () => undefined,
    rotateRefresh: async ({ grantId, presentedVersion, now }) => {
      const row = rows.get(grantId)
      if (!row || row.revokedAt !== undefined) return { ok: false, reason: 'revoked' }
      if (presentedVersion !== row.refreshVersion) { row.revokedAt = now; return { ok: false, reason: 'reused' } }
      row.refreshVersion += 1
      return { ok: true, version: row.refreshVersion }
    },
    revoke: async ({ grantId, userId, now }) => {
      const row = rows.get(grantId)
      if (!row || row.userId !== userId || row.revokedAt !== undefined) return false
      row.revokedAt = now
      return true
    },
    deleteAllForUser: async () => 0,
  }
}

function setup(options: { members?: Set<string>; now?: () => number } = {}) {
  const grants = memoryGrants()
  const members = options.members ?? new Set(['user-1:ws-1'])
  const service = new McpAccessService({
    grants,
    workspaces: { resolveActiveWorkspace: async (userId, workspaceId) => { if (!members.has(`${userId}:${workspaceId}`)) throw new Error('no access'); return {} } },
    audit: { record: async () => ({}) as never },
    ...(options.now ? { now: options.now } : {}),
  })
  return { service, grants, members }
}

const verifier = 'v'.repeat(64)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const redirect = 'https://chatgpt.com/connector/oauth/abc'

function register(service: McpAccessService) {
  return service.registerClient({ client_name: 'ChatGPT', redirect_uris: [redirect] }).client_id
}

async function authorize(service: McpAccessService, clientId: string, overrides: Record<string, unknown> = {}) {
  const { redirectUrl } = await service.approveAuthorization({
    userId: 'user-1', workspaceId: 'ws-1', access: 'write', clientId, redirectUri: redirect, codeChallenge: challenge, state: 'xyz', ...overrides,
  } as never)
  return new URL(redirectUrl).searchParams
}

const tokenParams = (clientId: string, code: string, extra: Record<string, string> = {}) => new URLSearchParams({
  grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier, ...extra,
})

test('registration accepts https, localhost, and app-scheme redirects and refuses unsafe ones', () => {
  const { service } = setup()
  for (const uri of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:6274/callback', 'http://127.0.0.1:8080/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback']) {
    assert.ok(service.registerClient({ client_name: 'App', redirect_uris: [uri] }).client_id.startsWith('ovclient_'), uri)
  }
  for (const uri of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://x.example/cb#frag', 'not a url']) {
    assert.throws(() => service.registerClient({ client_name: 'App', redirect_uris: [uri] }), McpOAuthError, uri)
  }
  assert.throws(() => service.registerClient({ redirect_uris: [] }), McpOAuthError)
  assert.equal(service.registerClient({ client_name: '  Evil\u0000 name  ', redirect_uris: [redirect] }).client_name, 'Evil name')
})

test('the full flow: approve, exchange the code with PKCE, use the token, refresh, and revoke', async () => {
  const { service } = setup()
  const clientId = register(service)
  const params = await authorize(service, clientId)
  assert.equal(params.get('state'), 'xyz')
  const tokens = await service.exchange(tokenParams(clientId, params.get('code')!))
  assert.equal(tokens.token_type, 'Bearer')
  assert.equal(tokens.scope, 'mcp:write')
  const principal = await service.authenticate(tokens.access_token)
  assert.deepEqual({ ...principal, grantId: undefined }, { grantId: undefined, userId: 'user-1', workspaceId: 'ws-1', access: 'write', clientName: 'ChatGPT' })

  const refreshed = await service.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }))
  assert.ok(await service.authenticate(refreshed.access_token))
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token)

  assert.equal(await service.revoke('user-2', principal!.grantId), false)
  assert.equal(await service.revoke('user-1', principal!.grantId), true)
  assert.equal(await service.authenticate(tokens.access_token), null)
})

test('a code is bound to its client, redirect, and verifier, and works once', async () => {
  const { service } = setup()
  const clientId = register(service)
  const other = service.registerClient({ client_name: 'Other', redirect_uris: [redirect] }).client_id
  const code = (await authorize(service, clientId)).get('code')!
  await assert.rejects(service.exchange(tokenParams(other, code)), /different client/)
  await assert.rejects(service.exchange(tokenParams(clientId, code, { redirect_uri: 'https://evil.example/cb' })), /redirect URI/)
  await assert.rejects(service.exchange(tokenParams(clientId, code, { code_verifier: 'w'.repeat(64) })), /PKCE/)
  await service.exchange(tokenParams(clientId, code))
  await assert.rejects(service.exchange(tokenParams(clientId, code)), /already used/)
})

test('a replayed refresh token signs the grant out', async () => {
  const { service } = setup()
  const clientId = register(service)
  const tokens = await service.exchange(tokenParams(clientId, (await authorize(service, clientId)).get('code')!))
  const rotate = (token: string) => service.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }))
  const second = await rotate(tokens.refresh_token)
  await assert.rejects(rotate(tokens.refresh_token), /no longer valid/)
  // The thief's replay also ended the real client's grant.
  assert.equal(await service.authenticate(second.access_token), null)
  await assert.rejects(rotate(second.refresh_token), /no longer valid/)
})

test('approval needs a registered redirect, a valid level, a challenge, and workspace membership', async () => {
  const { service } = setup()
  const clientId = register(service)
  await assert.rejects(authorize(service, clientId, { redirectUri: 'https://evil.example/cb' }), /not registered/)
  await assert.rejects(authorize(service, clientId, { access: 'root' }), /Choose what/)
  await assert.rejects(authorize(service, clientId, { codeChallenge: 'short' }), /PKCE/)
  await assert.rejects(authorize(service, clientId, { workspaceId: 'ws-2' }), /access to that workspace/)
  await assert.rejects(authorize(service, 'ovclient_forged.sig'), /Unknown client/)
  assert.equal(new URL(service.denyAuthorization({ clientId, redirectUri: redirect, state: 's' }).redirectUrl).searchParams.get('error'), 'access_denied')
})

test('a token stops working when the person leaves the workspace or the token expires', async () => {
  let clock = 1_000_000
  const { service, members } = setup({ now: () => clock })
  const clientId = register(service)
  const tokens = await service.exchange(tokenParams(clientId, (await authorize(service, clientId)).get('code')!))
  assert.ok(await service.authenticate(tokens.access_token))
  members.clear()
  assert.equal(await service.authenticate(tokens.access_token), null)

  const personal = setup({ now: () => clock })
  const { token } = await personal.service.createPersonalToken({ userId: 'user-1', workspaceId: 'ws-1', access: 'read', name: 'Cursor', ttlDays: 1 })
  assert.ok(await personal.service.authenticate(token))
  clock += 2 * 24 * 60 * 60_000
  assert.equal(await personal.service.authenticate(token), null)
})

test('personal tokens carry the chosen level, never refresh, and are not accepted as other kinds', async () => {
  const { service } = setup()
  const { token, grant } = await service.createPersonalToken({ userId: 'user-1', workspaceId: 'ws-1', access: 'read', name: 'Local agent' })
  assert.equal(grant.access, 'read')
  assert.equal((await service.authenticate(token))?.access, 'read')
  await assert.rejects(service.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token })), /invalid or expired/)
  await assert.rejects(service.createPersonalToken({ userId: 'user-1', workspaceId: 'ws-9', access: 'read', name: 'x' }), /access to that workspace/)
  assert.equal(await service.authenticate('ovmcu_a_forged.sig'), null)
  assert.equal(await service.authenticate(null), null)
})
