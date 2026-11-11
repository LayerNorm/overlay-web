import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  isFreshAccountDeletionBearer,
  ACCOUNT_DELETION_TOKEN_MAX_AGE_SECONDS,
} from './account-deletion-auth'
type DeletionAuth = Parameters<typeof isFreshAccountDeletionBearer>[1]

const now = Math.floor(Date.now() / 1000)
const bearer: DeletionAuth = {
  userId: 'user-1',
  accessToken: 'verified-token',
  authType: 'access-token',
}

function fixture(
  options: {
    auth?: DeletionAuth | null
    claims?: { sub?: unknown; iat?: unknown } | null
    cookies?: boolean
    origin?: string
    crossSite?: boolean
    confirmation?: string
    rateLimited?: boolean
    failDeletion?: boolean
    authorization?: string
  } = {},
) {
  const calls = { deleted: [] as string[], verified: [] as string[], cleared: 0, audited: 0 }
  const auth = options.auth === undefined ? bearer : options.auth
  const session =
    auth?.authType === 'session'
      ? { user: { id: auth.userId, email: 'test@example.invalid' } }
      : null
  const server = {
    auth: {
      verifyAccessToken: async (token: string) => {
        calls.verified.push(token)
        return options.claims === undefined ? { sub: 'user-1', iat: now } : options.claims
      },
    },
    auditService: {
      record: async () => {
        calls.audited++
      },
    },
  }
  const dependencies: Record<string, unknown> = {
    '@/server/observability/logger': { logger: { info() {}, error() {} } },
    'next/server': { NextResponse: Response },
    '@/server/account/account-deletion-auth': { isFreshAccountDeletionBearer },
    '@/server/account/AccountDeletionService': {
      AccountDeletionService: class {
        async deleteAccount({ userId }: { userId: string }) {
          if (options.failDeletion) throw new Error('Storage unavailable')
          calls.deleted.push(userId)
          return { deletedRowCount: 3 }
        }
      },
    },
    '@/server/auth/app-api-auth': { resolveAuthenticatedAppUser: async () => auth },
    '@/server/auth/session': {
      getOverlaySession: async () => session,
      clearOverlaySession: async () => {
        calls.cleared++
        return new Headers({ 'set-cookie': 'overlay_session=; Max-Age=0' })
      },
    },
    '@/server/bootstrap': { getOverlayServerContext: () => server },
    '@/server/security/rate-limit': {
      getClientIp: () => '127.0.0.1',
      enforceRateLimits: async () =>
        options.rateLimited ? Response.json({ error: 'Rate limited' }, { status: 429 }) : null,
    },
  }
  const source = readFileSync(
    new URL('../../app/api/account/delete/route.ts', import.meta.url),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } }
  vm.runInNewContext('(function(require,module,exports){' + compiled + '\n})', {
    Response,
    Headers,
  })(
    (id: string) => {
      assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id)
      return dependencies[id]
    },
    loaded,
    loaded.exports,
  )
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: options.authorization ?? 'Bearer verified-token',
  })
  if (options.cookies) headers.set('cookie', 'overlay_session=fixture')
  if (options.origin) headers.set('origin', options.origin)
  if (options.crossSite) headers.set('sec-fetch-site', 'cross-site')
  const request = Object.assign(
    new Request('https://preview.invalid/api/account/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmation: options.confirmation ?? 'DELETE' }),
    }),
    { nextUrl: new URL('https://preview.invalid/api/account/delete') },
  )
  return { calls, run: () => loaded.exports.POST(request) }
}

test('fresh verified cookie-free bearer deletes its user through the existing route', async () => {
  const f = fixture()
  const response = await f.run()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, deletedRowCount: 3 })
  assert.deepEqual(f.calls.deleted, ['user-1'])
  assert.deepEqual(f.calls.verified, ['verified-token'])
  assert.equal(f.calls.audited, 1)
  assert.equal(f.calls.cleared, 0)
})

test('stale, missing, non-finite, future and mismatched verified claims cannot delete', async () => {
  for (const claims of [
    { sub: 'user-1', iat: now - 301 },
    { sub: 'user-1' },
    { sub: 'user-1', iat: NaN },
    { sub: 'user-1', iat: now + 60 },
    { sub: 'other-user', iat: now },
    null,
  ]) {
    const f = fixture({ claims })
    assert.equal((await f.run()).status, 403)
    assert.deepEqual(f.calls.deleted, [])
    assert.equal(f.calls.audited, 0)
  }
})

test('five-minute boundary uses verified issuance, not untrusted request claims', async () => {
  const request = new Request('https://preview.invalid', {
    headers: { authorization: 'Bearer verified-token' },
  })
  assert.equal(ACCOUNT_DELETION_TOKEN_MAX_AGE_SECONDS, 300)
  assert.equal(
    await isFreshAccountDeletionBearer(
      request,
      bearer,
      async () => ({ sub: 'user-1', iat: now - 300 }),
      now,
    ),
    true,
  )
  assert.equal(
    await isFreshAccountDeletionBearer(
      request,
      bearer,
      async () => ({ sub: 'user-1', iat: now - 301 }),
      now,
    ),
    false,
  )
  assert.equal(
    await isFreshAccountDeletionBearer(
      request,
      bearer,
      async () => {
        throw new Error('Invalid signature')
      },
      now,
    ),
    false,
  )
})

test('cookie sessions retain same-origin deletion and session cleanup, without freshness checks', async () => {
  const f = fixture({
    auth: { ...bearer, authType: 'session' },
    cookies: true,
    origin: 'https://preview.invalid',
    claims: { sub: 'user-1', iat: 1 },
  })
  const response = await f.run()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/)
  assert.equal(f.calls.cleared, 1)
  assert.deepEqual(f.calls.verified, [])
})

test('cookie sessions with a bearer header still enforce missing/foreign/cross-site origin checks', async () => {
  for (const input of [
    {},
    { origin: 'https://other.invalid' },
    { origin: 'https://preview.invalid', crossSite: true },
  ]) {
    const f = fixture({ ...input, auth: { ...bearer, authType: 'session' }, cookies: true })
    assert.equal((await f.run()).status, 403)
    assert.deepEqual(f.calls.deleted, [])
  }
})

test('only the cookie-free bearer path skips browser origin enforcement', async () => {
  assert.equal(
    (await fixture({ origin: 'https://other.invalid', crossSite: true }).run()).status,
    200,
  )
  for (const options of [
    { cookies: true },
    { authorization: '' },
    { authorization: 'Bearer other-token' },
    { auth: { ...bearer, authType: 'api-key' as const } },
    { auth: { ...bearer, authType: 'service' as const } },
  ]) {
    const f = fixture(options)
    assert.equal((await f.run()).status, 403)
    assert.deepEqual(f.calls.deleted, [])
  }
})

test('authentication, confirmation, rate limits and cleanup failure remain enforced', async () => {
  for (const [options, status] of [
    [{ auth: null }, 401],
    [{ confirmation: '' }, 400],
    [{ rateLimited: true }, 429],
    [{ failDeletion: true }, 500],
  ] as const) {
    const f = fixture(options)
    assert.equal((await f.run()).status, status)
    assert.deepEqual(f.calls.deleted, [])
  }
})
