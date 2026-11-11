import { beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), query: vi.fn(), payer: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/authorization/ensure-default-user-role', () => ({ ensureDefaultUserRole: mocks.initialize }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/auth/session', () => ({ getOverlaySession: async () => null }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'test-only' }))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: { query: mocks.query } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ billingPayerResolver: { resolve: mocks.payer } }) }))
vi.mock('@/server/config', () => ({ getOverlayRuntimeConfig: async () => ({}), formatOverlayConfigError: vi.fn(), getRedactedOverlayRuntimeConfigSummary: vi.fn() }))
vi.mock('@/shared/config', () => ({ isRuntimeConfigSummaryVisible: () => false }))
vi.mock('@/overlay.config', () => ({ default: {} }))
vi.mock('@/server/agents/external-agent-policy', () => ({ externalAgentLaunchEnabled: async () => false }))
vi.mock('@/server/capabilities', () => ({ getOverlayCapabilities: async () => ({}), withWorkspaceExternalAgentCapabilities: () => ({}) }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalog: async () => null }))
vi.mock('@/shared/ai/gateway/model-data', () => ({ AVAILABLE_MODELS: [], IMAGE_MODELS: [], VIDEO_MODELS: [], registerGatewayCatalogModels: vi.fn() }))
vi.mock('@/shared/ai/gateway/model-types', () => ({ DEFAULT_MODEL_ID: 'chat', DEFAULT_IMAGE_MODEL_ID: 'image', DEFAULT_VIDEO_MODEL_ID: 'video' }))
vi.mock('@overlay/app-core', () => ({
  DEFAULT_APP_SETTINGS: {}, overlayNavigationToDestinations: () => [],
  resolveOverlayAppShellConfig: () => Object.fromEntries(['navigation', 'settingsSections', 'featureFlags', 'featureModules', 'sidebarActions', 'settingsPanels', 'tools', 'integrations', 'modelProviders', 'policyGates'].map(key => [key, []])),
}))

function context(authType: AppApiRouteContext['auth']['authType'] = 'access-token') {
  return {
    auth: { authType, userId: 'verified-native-user', accessToken: 'verified-test-token' },
    workspace: { workspace: { id: 'workspace' } }, parsedJson: { userId: 'forged-user' },
  } as AppApiRouteContext
}
const request = () => new NextRequest('https://example.test/api/v1/bootstrap?userId=forged-user')

beforeEach(() => {
  vi.resetAllMocks()
  mocks.initialize.mockResolvedValue(undefined)
  mocks.query.mockResolvedValue(null)
  mocks.payer.mockResolvedValue({ scope: 'personal' })
})

test('native bootstrap initializes only the verified user before returning app state, including repeat calls', async () => {
  for (let index = 0; index < 2; index++) expect((await GET(request(), context())).status).toBe(200)
  expect(mocks.initialize.mock.calls).toEqual([['verified-native-user'], ['verified-native-user']])
  expect(mocks.initialize.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0])
})

test('native initialization failure remains an error and cannot return cached-looking bootstrap success', async () => {
  mocks.initialize.mockRejectedValue(new Error('Initialization unavailable'))
  const response = await GET(request(), context())
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Failed to load app bootstrap' })
  expect(mocks.query).not.toHaveBeenCalled()
  expect(mocks.payer).not.toHaveBeenCalled()
})

test.each(['session', 'api-key', 'service'] as const)('%s bootstrap does not add native authorization grants', async authType => {
  expect((await GET(request(), context(authType))).status).toBe(200)
  expect(mocks.initialize).not.toHaveBeenCalled()
})
