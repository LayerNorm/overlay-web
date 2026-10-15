import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest, NextResponse } from 'next/server'
import { adminRoute } from './guard'
import { AdministrativeAuthorizationError } from './admin/AdministrativeService'
import { ADMIN_SESSION_COOKIE, sealPayload } from './session'
import { adminConvexQuery } from './convex-admin'
import { GET as readPeople } from '../app/api/v1/admin/usage/route'
import { POST as createRole } from '../app/api/v1/admin/authorization/roles/route'

process.env.ADMIN_SESSION_SECRET = 'test-session-secret'
process.env.ADMIN_ALLOWED_USER_IDS = 'user_admin'
process.env.ADMIN_API_SECRET = 'test-admin-secret'
process.env.ADMIN_CONVEX_URL = 'https://fixture.invalid'

function request(args: { authenticated?: boolean; stale?: boolean; origin?: string; body?: string } = {}) {
  const now = Date.now()
  const token = `header.${Buffer.from(JSON.stringify({ auth_time: Math.floor(now / 1000) - (args.stale ? 3600 : 0) })).toString('base64url')}.sig`
  const cookie = sealPayload({ accessToken: token, refreshToken: null, lastActiveAt: now, signedInAt: now,
    user: { id: 'user_admin', email: 'review@example.invalid', firstName: null, lastName: null } })
  return new NextRequest('https://admin.example.invalid/api/v1/admin/authorization/roles', {
    method: 'POST', body: args.body ?? '{}', headers: { Origin: args.origin ?? 'https://admin.example.invalid', 'Content-Type': 'application/json',
      ...(args.authenticated === false ? {} : { Cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` }) },
  })
}

test('complete route wrapper preserves operator identity for success and denied audit', async () => {
  const previous = globalThis.fetch
  let operatorRole = 'admin'
  const calls: { path: string; token: string | null }[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const token = new Headers(init?.headers).get('Authorization')
    calls.push({ path: body.path, token })
    assert.ok(token)
    return Response.json({ status: 'success', value: body.path.endsWith('getPrincipal')
      ? { userId: 'user_admin', role: operatorRole, createdAt: 1, updatedAt: 1 }
      : body.path.endsWith('appendAudit') ? { ...body.args, eventId: 'review', metadataJson: '{}' } : [] })
  }
  try {
    const success = adminRoute(async () => NextResponse.json(await adminConvexQuery('admin/console:listRoles', { includeArchived: false })), { mutation: true })
    assert.equal((await success(request())).status, 200)
    assert.equal((await success(request({ authenticated: false }))).status, 401)
    assert.equal((await success(request({ origin: 'https://other.example.invalid' }))).status, 403)
    assert.equal((await success(request({ stale: true }))).status, 403)
    const denied = adminRoute(() => { throw new AdministrativeAuthorizationError() }, { mutation: true, auditAction: 'review.denied' })
    assert.equal((await denied(request())).status, 403)
    assert.ok(calls.some((call) => call.path.endsWith('appendAudit') && call.token))
    for (const role of ['admin', 'billing_admin', 'support', 'auditor']) {
      operatorRole = role
      const get = new NextRequest('https://admin.example.invalid/api/v1/admin/usage', { headers: request().headers })
      assert.equal((await readPeople(get)).status, role === 'auditor' ? 403 : 200)
    }
    operatorRole = 'admin'
    assert.equal((await createRole(request({ body: 'null' }))).status, 400)
    assert.equal((await createRole(request({ body: '{"capabilities":["invented"],"name":"Invalid"}' }))).status, 400)
  } finally { globalThis.fetch = previous }
})
