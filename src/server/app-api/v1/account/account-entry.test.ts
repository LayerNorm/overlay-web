import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { handleBffRoute } from '@/app/api/v1/_utils/bff'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

process.env.NEXT_PHASE = 'phase-production-build'
process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud'
process.env.INTERNAL_API_SECRET = 'account-entry-test-secret'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'

function workspaceAccess() {
  return {
    workspace: {
      id: 'workspace_1',
      kind: 'organization' as const,
      name: 'Studio',
      slug: 'studio',
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    },
    principal: {
      id: 'principal_1',
      workspaceId: 'workspace_1',
      type: 'human' as const,
      userId: 'user_1',
      displayName: 'Member',
      createdAt: 1,
      updatedAt: 1,
    },
    membership: {
      membershipId: 'membership_1',
      workspaceId: 'workspace_1',
      principalId: 'principal_1',
      role: 'owner' as const,
      status: 'active' as const,
      joinedAt: 1,
      updatedAt: 1,
    },
  }
}

function request(path: string, method = 'GET', body?: unknown, accessToken?: string) {
  return new NextRequest(`https://overlay.test${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : {
        'content-type': 'application/json',
        Origin: 'https://overlay.test',
        'Sec-Fetch-Site': 'same-origin',
      }),
      ...(method === 'POST' ? { 'Idempotency-Key': 'account-entry-test' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
}

test('account directory, creation, and invitation acceptance skip workspace bootstrap while legacy BFF still resolves context', async (t) => {
  const server = getOverlayServerContext()
  const access = workspaceAccess()
  let resolveCalls = 0
  let summaryResolveCalls = 0
  let ensureCalls = 0
  let createCalls = 0
  let idempotencyReservations = 0
  let acceptedEmail = ''
  let listedInvitationEmail = ''
  let sessionEnabled = true
  t.mock.method(server.auth, 'getSession', async () => sessionEnabled
    ? {
        accessToken: 'session-token',
        user: { id: 'user_1', email: 'member@example.test', firstName: 'Member' },
      }
    : null)
  t.mock.method(server.auth, 'verifyAccessToken', async (token) =>
    token === 'access-token' ? { sub: 'user_1' } : null)
  t.mock.method(server.rateLimiter, 'check', async (
    _scope: Parameters<typeof server.rateLimiter.check>[0],
    rules: Parameters<typeof server.rateLimiter.check>[1],
  ) => ({
    allowed: true,
    retryAfterSeconds: 0,
    decisions: rules.map((rule) => ({
      bucket: rule.bucket,
      allowed: true,
      remaining: rule.limit - 1,
      retryAfterSeconds: 0,
    })),
  }))
  t.mock.method(server.auditService, 'record', async () => undefined)
  t.mock.method(server.appData.repositories.idempotency, 'reserve', async (args) => {
    idempotencyReservations += 1
    assert.equal(args.userId, 'user_1')
    assert.equal(args.method, 'POST')
    return { status: 'reserved' }
  })
  t.mock.method(server.appData.repositories.idempotency, 'complete', async () => true)
  t.mock.method(server.appData.repositories.idempotency, 'discard', async () => true)
  t.mock.method(server.workspaceService, 'ensurePersonalWorkspace', async () => {
    ensureCalls += 1
    throw new Error('account routes must not create a personal workspace')
  })
  t.mock.method(server.workspaceService, 'resolveActiveWorkspace', async () => {
    resolveCalls += 1
    return access
  })
  t.mock.method(server.workspaceService, 'listForUser', async () => [])
  t.mock.method(server.workspaceService, 'listReceivedInvitations', async (args) => {
    listedInvitationEmail = args.email
    return []
  })
  t.mock.method(server.workspaceService, 'createOrganization', async () => {
    createCalls += 1
    return access
  })
  t.mock.method(server.workspaceService, 'setActiveWorkspace', async () => access)
  t.mock.method(server.workspaceService, 'resolveWorkspaceHandle', async () => {
    summaryResolveCalls += 1
    return { workspaceId: access.workspace.id, canonicalHandle: access.workspace.slug, canonical: true }
  })
  t.mock.method(server.workspaceService, 'acceptInvitation', async (args) => {
    acceptedEmail = args.email
    return access
  })

  const directory = await import('@/app/api/v1/account/workspaces/route')
  const listed = await directory.GET(request('/api/v1/account/workspaces?email=attacker@example.test'))
  assert.equal(listed.status, 200)
  assert.deepEqual(await listed.json(), { workspaces: [], activeWorkspaceId: '', invitations: [] })
  assert.equal(listedInvitationEmail, 'member@example.test')
  assert.equal(resolveCalls, 0)
  assert.equal(ensureCalls, 0)

  sessionEnabled = false
  const rejectedDirectory = await directory.GET(
    request('/api/v1/account/workspaces?userId=user_1', 'GET', undefined, 'access-token'),
  )
  assert.equal(rejectedDirectory.status, 403)
  const rejectedCreate = await directory.POST(
    request('/api/v1/account/workspaces?userId=user_1', 'POST', { name: 'Studio' }, 'access-token'),
  )
  assert.equal(rejectedCreate.status, 403)
  const accept = await import('@/app/api/v1/workspace-invitations/[invitationId]/accept/route')
  const rejectedAccept = await accept.POST(
    request('/api/v1/workspace-invitations/invite_1/accept?userId=user_1', 'POST', {}, 'access-token'),
    { params: Promise.resolve({ invitationId: 'invite_1' }) },
  )
  assert.equal(rejectedAccept.status, 403)
  assert.equal(createCalls, 0)
  assert.equal(idempotencyReservations, 0)
  assert.equal(acceptedEmail, '')
  assert.equal(resolveCalls, 0)
  assert.equal(ensureCalls, 0)

  sessionEnabled = true
  const create = await directory.POST(request('/api/v1/account/workspaces', 'POST', { name: 'Studio' }))
  assert.equal(create.status, 201)
  assert.match(create.headers.get('set-cookie') ?? '', /overlay_active_workspace=workspace_1/)
  assert.equal(createCalls, 1)
  assert.equal(idempotencyReservations, 1)
  assert.equal(summaryResolveCalls, 1)
  assert.equal(resolveCalls, 0)
  assert.equal(ensureCalls, 0)

  const accepted = await accept.POST(
    request('/api/v1/workspace-invitations/invite_1/accept', 'POST', {}),
    { params: Promise.resolve({ invitationId: 'invite_1' }) },
  )
  assert.equal(accepted.status, 200)
  assert.equal(acceptedEmail, 'member@example.test')
  assert.equal(idempotencyReservations, 2)
  assert.equal(summaryResolveCalls, 2)
  assert.equal(resolveCalls, 0)
  assert.equal(ensureCalls, 0)

  const legacy = await handleBffRoute(
    request('/api/v1/legacy-workspace-handler'),
    {},
    (_request, context: AppApiRouteContext) => {
      assert.equal(context.workspace.workspace.id, 'workspace_1')
      return Response.json({ workspaceId: context.workspace.workspace.id })
    },
  )
  assert.equal(legacy.status, 200)
  assert.equal(resolveCalls, 1)
})
