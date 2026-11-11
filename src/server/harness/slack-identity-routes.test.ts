import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { startSlackIdentity, callbackSlackIdentity, unlinkSlackIdentityRoute } from '@/server/surfaces/slack-identity-routes'
import { sealSlackIdentityState } from '@/server/surfaces/slack-identity-oauth'

const mocks = vi.hoisted(() => ({ userId: 'alice', active: true, begin: vi.fn(), complete: vi.fn(), exchange: vi.fn(), unlink: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/security/rate-limit', () => ({ enforceRateLimits: async () => null, getClientIp: () => 'fixture' }))
vi.mock('@/server/security/rate-limit-specs', () => ({ getEndpointRateLimitSpecs: () => [] }))
vi.mock('@/server/auth/session', () => ({ getOverlaySession: async () => mocks.userId ? { user: { id: mocks.userId } } : null }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  workspaceService: { resolveActiveWorkspace: async () => ({ workspace: { id: 'ws' } }) },
  surfaceService: { listConnections: async () => mocks.active ? [{ id: 'connection', workspaceId: 'ws', platform: 'slack', status: 'active', externalTeamId: 'T1' }] : [] },
}) }))
vi.mock('@/server/surfaces/slack-identity-store', () => ({ beginSlackIdentity: mocks.begin, completeSlackIdentity: mocks.complete, unlinkSlackIdentity: mocks.unlink }))
vi.mock('@/server/surfaces/slack-identity-profile', () => ({ slackIdentityDisplayName: async () => 'dana' }))
vi.mock('@/server/surfaces/slack-identity-oauth', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/surfaces/slack-identity-oauth')>(), exchangeSlackIdentity: mocks.exchange,
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SESSION_SECRET', 'identity-route-fixture')
  vi.stubEnv('SLACK_CLIENT_ID', 'client')
  mocks.userId = 'alice'
  mocks.active = true
  mocks.exchange.mockResolvedValue({ externalUserId: 'U1', externalTeamId: 'T1' })
  mocks.complete.mockResolvedValue({ status: 'linked' })
})
afterEach(() => vi.unstubAllEnvs())
const request = (state: string) => new NextRequest(`https://overlay.example/api/v1/surfaces/slack/identity/callback?code=code&state=${encodeURIComponent(state)}`)
function state() { return sealSlackIdentityState({ userId: 'alice', workspaceId: 'ws', connectionId: 'connection', teamId: 'T1' }).state }

test('start stores a one-use nonce and requests only openid from the active workspace installation', async () => {
  const response = await startSlackIdentity(new NextRequest('https://overlay.example/api/v1/surfaces/slack/identity/start?workspaceId=ws&connectionId=connection'))
  const url = new URL(response.headers.get('location')!)
  expect(url.searchParams.get('scope')).toBe('openid')
  expect(url.searchParams.get('team')).toBe('T1')
  expect(url.searchParams.get('redirect_uri')).toBe('https://overlay.example/api/v1/surfaces/slack/identity/callback')
  expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice', workspaceId: 'ws', teamId: 'T1', nonce: url.searchParams.get('nonce') }))
  mocks.active = false
  expect((await startSlackIdentity(new NextRequest('https://overlay.example/api/v1/surfaces/slack/identity/start?workspaceId=ws&connectionId=connection'))).status).toBe(403)
})

test('tampered state and a different or absent session cannot exchange or consume a nonce', async () => {
  const signed = state()
  expect((await callbackSlackIdentity(request(`tampered${signed}`))).status).toBe(403)
  for (const userId of ['bob', '']) {
    mocks.userId = userId
    expect((await callbackSlackIdentity(request(signed))).status).toBe(403)
  }
  expect(mocks.exchange).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
})

test('verified callback links, renders clear conflicts and rejects replay or token verification failure', async () => {
  const signed = state()
  expect((await callbackSlackIdentity(request(signed))).status).toBe(200)
  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice', teamId: 'T1' }), 'U1', 'dana')
  mocks.complete.mockResolvedValueOnce({ status: 'conflict' })
  const conflict = await callbackSlackIdentity(request(signed))
  expect(conflict.status).toBe(409)
  expect(await conflict.text()).toContain('different Overlay account')
  mocks.complete.mockRejectedValueOnce(new Error('NONCE_INVALID'))
  expect((await callbackSlackIdentity(request(signed))).status).toBe(400)
  mocks.exchange.mockRejectedValueOnce(new Error('Invalid signature'))
  expect((await callbackSlackIdentity(request(signed))).status).toBe(400)
})

test('unlink uses the session actor and rejects cross-origin requests', async () => {
  const make = (origin: string) => new NextRequest('https://overlay.example/api/v1/surfaces/slack/identity/unlink', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'ws', linkId: 'link', actorUserId: 'admin' }) })
  expect((await unlinkSlackIdentityRoute(make('https://attacker.example'))).status).toBe(403)
  expect(mocks.unlink).not.toHaveBeenCalled()
  expect((await unlinkSlackIdentityRoute(make('https://overlay.example'))).status).toBe(200)
  expect(mocks.unlink).toHaveBeenCalledWith({ actorUserId: 'alice', workspaceId: 'ws', linkId: 'link' })
})
