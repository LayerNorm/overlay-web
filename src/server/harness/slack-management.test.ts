import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { appendMutableCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { SurfaceService } from '@/server/surfaces/SurfaceService'
import { POST, GET as bindings } from '@/server/app-api/v1/surfaces/bindings/route'
import { DELETE as disconnect } from '@/server/app-api/v1/surfaces/connections/route'
import { GET as connect } from '@/app/api/v1/surfaces/slack/connect/route'
import { GET as callback } from '@/app/api/v1/surfaces/slack/callback/route'
import { sealSlackConnectState } from '@/server/surfaces/slack-oauth'

const mocks = vi.hoisted(() => ({
  service: null as unknown as SurfaceService, role: 'admin', create: vi.fn(), update: vi.fn(), exchange: vi.fn(),
  deleteInstallation: vi.fn(), channels: vi.fn(), sessionUserId: 'user' as string | null, getSession: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: mocks.service,
  workspaceService: { resolveActiveWorkspace: async () => ({ workspace: { id: 'ws' }, principal: { id: 'human' }, membership: { role: mocks.role } }) },
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}) }))
vi.mock('@/server/auth/session', () => ({ getOverlaySession: mocks.getSession }))
vi.mock('@/server/security/rate-limit', () => ({ enforceRateLimits: async () => null, getClientIp: () => 'fixture' }))
vi.mock('@/server/security/rate-limit-specs', () => ({ getEndpointRateLimitSpecs: () => [] }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/server/surfaces/chat', () => ({ slackConfigured: () => true, getSlackAdapter: async () => ({
  handleOAuthCallback: mocks.exchange, deleteInstallation: mocks.deleteInstallation,
}) }))

type TestCookie = { name: string; value: string; path: string; httpOnly: boolean; secure: boolean; sameSite: 'lax' }
const modifiedCookieKey = Symbol.for('next.mutated.cookies')
const mutableCookies: Record<PropertyKey, TestCookie[]> = { [modifiedCookieKey]: [] }

function queueRefreshedCookie() {
  mutableCookies[modifiedCookieKey].push({
    name: 'overlay_session', value: 'rotated-fixture', path: '/', httpOnly: true, secure: true, sameSite: 'lax',
  })
}

function finalizeRouteResponse(response: Response): Response {
  const headers = new Headers(response.headers)
  if (!appendMutableCookies(headers, mutableCookies as never)) return response
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const chief = { id: 'chief', workspaceId: 'ws', agentRole: 'workspace_chief', harness: 'overlay', principalId: 'chief-principal' }
const connection = { id: 'connection', workspaceId: 'ws', status: 'active', externalTeamId: 'T1' }
function context(body: Record<string, unknown> = {}, role = 'admin'): AppApiRouteContext {
  return { parsedJson: body, parsedQuery: {}, auth: { userId: 'user' }, workspace: {
    workspace: { id: 'ws' }, principal: { id: 'human' }, membership: { role },
  } } as unknown as AppApiRouteContext
}
beforeEach(() => {
  vi.clearAllMocks()
  mutableCookies[modifiedCookieKey].length = 0
  vi.stubEnv('SESSION_SECRET', 'slack-management-fixture')
  vi.stubEnv('SLACK_CLIENT_ID', 'client')
  mocks.role = 'admin'
  mocks.sessionUserId = 'user'
  mocks.getSession.mockImplementation(async (_request: Request, options?: { refresh?: boolean }) => {
    if (options?.refresh) queueRefreshedCookie()
    return mocks.sessionUserId ? { user: { id: mocks.sessionUserId } } : null
  })
  mocks.create.mockImplementation(async row => row)
  mocks.update.mockResolvedValue({ ...connection, status: 'uninstalled' })
  mocks.channels.mockResolvedValue([{ id: 'C1', name: 'general' }])
  mocks.service = new SurfaceService({
    repository: {
      getConnection: async () => connection, listConnections: async () => [connection],
      listBindingsByChannel: async () => [], listBindingsByAgent: async () => [],
      createBinding: mocks.create, updateConnection: mocks.update,
    } as never,
    agents: { get: async () => chief, list: async () => [chief] } as never,
    channelLister: mocks.channels,
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

test('binding API resolves the Chief and rejects all client agent choices', async () => {
  const request = new Request('https://overlay.example')
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'C1' }))).status).toBe(201)
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'chief', channelName: 'general' }))
  for (const agentId of ['specialist', 'chief', null]) {
    expect((await POST(request, context({ agentId, connectionId: 'connection', channelId: 'C1' }))).status).toBe(400)
  }
  expect(mocks.create).toHaveBeenCalledOnce()
  expect((await bindings(request, context())).status).toBe(200)
})

test.each(['member', 'guest'])('non-admin %s cannot create bindings, connect, callback or disconnect', async (role) => {
  mocks.role = role
  const request = new Request('https://overlay.example')
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'C1' }, role))).status).toBe(403)
  const state = sealSlackConnectState({ workspaceId: 'ws', userId: 'user' })
  for (const response of [
    await connect(new NextRequest('https://overlay.example/api/v1/surfaces/slack/connect?workspaceId=ws')),
    await callback(new NextRequest(`https://overlay.example/api/v1/surfaces/slack/callback?state=${encodeURIComponent(state)}&code=code`)),
  ]) expect(response.headers.get('location')).toContain('surfaceError=forbidden')
  const ctx = context({}, role)
  ctx.parsedQuery = { connectionId: 'connection' }
  expect((await disconnect(request, ctx)).status).toBe(403)
  expect(mocks.exchange).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.deleteInstallation).not.toHaveBeenCalled()
})

test('workspace admin connect has no agent requirement; disconnect disables before removing the token', async () => {
  const response = await connect(new NextRequest('https://overlay.example/api/v1/surfaces/slack/connect?workspaceId=ws'))
  expect(response.headers.get('location')).toContain('slack.com/oauth/v2/authorize')
  const ctx = context()
  ctx.parsedQuery = { connectionId: 'connection' }
  expect((await disconnect(new Request('https://overlay.example'), ctx)).status).toBe(200)
  expect(mocks.update).toHaveBeenCalledWith('connection', expect.objectContaining({ status: 'uninstalled' }))
  expect(mocks.deleteInstallation).toHaveBeenCalledWith('T1')
})

test('Slack install callback refreshes the same user and returns the rotated session cookie', async () => {
  const state = sealSlackConnectState({ workspaceId: 'ws', userId: 'user' })
  const request = new NextRequest(`https://overlay.example/api/v1/surfaces/slack/callback?state=${encodeURIComponent(state)}&code=code`)
  mocks.exchange.mockResolvedValue({ teamId: 'T1', installation: { teamName: 'Test workspace', botUserId: 'B1' } } as never)
  vi.spyOn(mocks.service, 'registerConnection').mockResolvedValue(undefined as never)

  const response = await callback(request)
  expect(mocks.getSession).toHaveBeenCalledWith(request, { refresh: true })
  expect(mocks.exchange).toHaveBeenCalledOnce()
  const finalized = finalizeRouteResponse(response)
  expect(finalized.headers.get('location')).toContain('surfaceConnected=slack')
  expect(finalized.headers.get('set-cookie')).toContain('overlay_session=rotated-fixture')
  expect(finalized.headers.get('set-cookie')).toContain('HttpOnly')
  expect(finalized.headers.get('set-cookie')).toContain('Secure')
  expect(finalized.headers.get('set-cookie')?.toLowerCase()).toContain('samesite=lax')
})

test.each([
  ['missing refresh', null],
  ['revoked refresh', null],
  ['different refreshed user', 'another-user'],
])('Slack install callback rejects a %s', async (_case, sessionUserId) => {
  mocks.sessionUserId = sessionUserId
  const state = sealSlackConnectState({ workspaceId: 'ws', userId: 'user' })
  const request = new NextRequest(`https://overlay.example/api/v1/surfaces/slack/callback?state=${encodeURIComponent(state)}&code=code`)

  const response = await callback(request)
  expect(mocks.getSession).toHaveBeenCalledWith(request, { refresh: true })
  expect(response.headers.get('location')).toContain('surfaceError=account_mismatch')
  expect(mocks.exchange).not.toHaveBeenCalled()
})

test('Slack install callback rejects a tampered state before refreshing the session', async () => {
  const state = sealSlackConnectState({ workspaceId: 'ws', userId: 'user' })
  const response = await callback(new NextRequest(
    `https://overlay.example/api/v1/surfaces/slack/callback?state=${encodeURIComponent(`tampered${state}`)}&code=code`,
  ))

  expect(response.headers.get('location')).toContain('surfaceError=expired_state')
  expect(mocks.getSession).not.toHaveBeenCalled()
  expect(mocks.exchange).not.toHaveBeenCalled()
})

test('Slack install callback fails closed when session refresh throws', async () => {
  const state = sealSlackConnectState({ workspaceId: 'ws', userId: 'user' })
  const request = new NextRequest(`https://overlay.example/api/v1/surfaces/slack/callback?state=${encodeURIComponent(state)}&code=code`)
  mocks.getSession.mockRejectedValueOnce(new Error('refresh failed'))

  const response = await callback(request)
  expect(response.headers.get('location')).toContain('surfaceError=account_mismatch')
  expect(mocks.exchange).not.toHaveBeenCalled()
})

test('binding API fails when the authoritative Chief is unavailable or the channel is ineligible', async () => {
  const request = new Request('https://overlay.example')
  mocks.channels.mockResolvedValue([])
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'D1' }))).status).toBe(400)
  vi.spyOn(mocks.service, 'resolveWorkspaceChief').mockRejectedValueOnce(new Error('unavailable'))
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'C1' }))).status).toBe(500)
  expect(mocks.create).not.toHaveBeenCalled()
})
