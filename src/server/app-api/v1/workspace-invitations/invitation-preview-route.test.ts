import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { GET } from '@/app/api/v1/workspace-invitations/[invitationId]/route'
import { WorkspaceInvitationPreviewService } from '@/server/workspaces/WorkspaceInvitationPreviewService'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

process.env.NEXT_PHASE = 'phase-production-build'
process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud'
process.env.INTERNAL_API_SECRET = 'invitation-preview-test-secret'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'

test('public GET needs no browser session, limits reads, and never caches bearer preview data', async (t) => {
  const server = getOverlayServerContext()
  let blocked = false
  t.mock.method(server.auth, 'getSession', async () => { throw new Error('must not require a session') })
  t.mock.method(server.rateLimiter, 'check', async (_scope, rules) => {
    assert.equal(rules[0].limit, 60)
    return { allowed: !blocked, retryAfterSeconds: blocked ? 60 : 0, decisions: rules.map(rule => ({ bucket: rule.bucket, allowed: !blocked, remaining: 0, retryAfterSeconds: blocked ? 60 : 0 })) }
  })
  const id = 'a62e9274-4e61-4e2e-b543-43f1ef106fc2'
  const data = { status: 'pending' as const, workspaceName: 'Acme', inviterName: null, role: 'member' as const, invitedEmail: 'dev@acme.com', workspaceBilling: 'free' as const }
  const mocked = t.mock.method(WorkspaceInvitationPreviewService.prototype, 'get', async (invitationId) => { assert.equal(invitationId, id); return data })
  const request = (invitationId = id) => GET(new NextRequest(`https://overlay.test/api/v1/workspace-invitations/${invitationId}`), { params: Promise.resolve({ invitationId }) })
  const response = await request()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), data)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal((await request('not-a-uuid')).status, 404)
  assert.equal(mocked.mock.calls.length, 1)
  mocked.mock.mockImplementation(async () => { throw new WorkspaceServiceError('Invitation not found', 404, 'not_found') })
  const missing = await request()
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: 'Invitation not found', code: 'not_found' })
  blocked = true
  assert.equal((await request()).status, 429)
})
