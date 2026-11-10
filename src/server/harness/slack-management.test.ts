import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { SurfaceService } from '@/server/surfaces/SurfaceService'
import { POST, GET as bindings } from '@/server/app-api/v1/surfaces/bindings/route'
import { DELETE as disconnect } from '@/server/app-api/v1/surfaces/connections/route'
import { GET as connect } from '@/app/api/v1/surfaces/slack/connect/route'
import { GET as callback } from '@/app/api/v1/surfaces/slack/callback/route'
import { sealSlackConnectState } from '@/server/surfaces/slack-oauth'

const mocks = vi.hoisted(() => ({
  service: null as unknown as SurfaceService, role: 'admin', create: vi.fn(), update: vi.fn(), exchange: vi.fn(),
  deleteInstallation: vi.fn(), channels: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: mocks.service,
  workspaceService: { resolveActiveWorkspace: async () => ({ workspace: { id: 'ws' }, principal: { id: 'human' }, membership: { role: mocks.role } }) },
  auditService: { record: vi.fn() },
}) }))
vi.mock('@/server/auth/session', () => ({ getOverlaySession: async () => ({ user: { id: 'user' } }) }))
vi.mock('@/server/security/rate-limit', () => ({ enforceRateLimits: async () => null, getClientIp: () => 'fixture' }))
vi.mock('@/server/security/rate-limit-specs', () => ({ getEndpointRateLimitSpecs: () => [] }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/server/surfaces/chat', () => ({ slackConfigured: () => true, getSlackAdapter: async () => ({
  handleOAuthCallback: mocks.exchange, deleteInstallation: mocks.deleteInstallation,
}) }))

const chief = { id: 'chief', workspaceId: 'ws', agentRole: 'workspace_chief', harness: 'overlay', principalId: 'chief-principal' }
const connection = { id: 'connection', workspaceId: 'ws', status: 'active', externalTeamId: 'T1' }
function context(body: Record<string, unknown> = {}, role = 'admin'): AppApiRouteContext {
  return { parsedJson: body, parsedQuery: {}, auth: { userId: 'user' }, workspace: {
    workspace: { id: 'ws' }, principal: { id: 'human' }, membership: { role },
  } } as unknown as AppApiRouteContext
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', 'slack-management-fixture')
  vi.stubEnv('SLACK_CLIENT_ID', 'client')
  mocks.role = 'admin'
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
afterEach(() => { vi.unstubAllEnvs() })

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

test('binding API fails when the authoritative Chief is unavailable or the channel is ineligible', async () => {
  const request = new Request('https://overlay.example')
  mocks.channels.mockResolvedValue([])
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'D1' }))).status).toBe(400)
  vi.spyOn(mocks.service, 'resolveWorkspaceChief').mockRejectedValueOnce(new Error('unavailable'))
  expect((await POST(request, context({ connectionId: 'connection', channelId: 'C1' }))).status).toBe(500)
  expect(mocks.create).not.toHaveBeenCalled()
})
