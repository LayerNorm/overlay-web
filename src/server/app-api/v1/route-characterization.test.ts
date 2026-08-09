import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { deriveOverlayCapabilities } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import { automationService } from '@/server/automations/http'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { fileService } from '@/server/files/http'
import {
  COMPOSIO_INTEGRATION_CAPABILITIES,
  ComposioIntegrationProvider,
  IntegrationService,
} from '@/server/integrations'
import type { WorkspaceConnectorRepository } from '@/server/integrations/WorkspaceConnectorRepository'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'

const originalNextPhase = process.env.NEXT_PHASE
const originalInternalApiSecret = process.env.INTERNAL_API_SECRET
const originalOverlayDeploymentEnv = process.env.OVERLAY_DEPLOYMENT_ENV
process.env.NEXT_PHASE = 'phase-production-build'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'
test.after(() => {
  if (originalNextPhase === undefined) {
    delete process.env.NEXT_PHASE
  } else {
    process.env.NEXT_PHASE = originalNextPhase
  }
  if (originalInternalApiSecret === undefined) {
    delete process.env.INTERNAL_API_SECRET
  } else {
    process.env.INTERNAL_API_SECRET = originalInternalApiSecret
  }
  if (originalOverlayDeploymentEnv === undefined) {
    delete process.env.OVERLAY_DEPLOYMENT_ENV
  } else {
    process.env.OVERLAY_DEPLOYMENT_ENV = originalOverlayDeploymentEnv
  }
})

const TEST_CONVEX_APP_DATA_CAPABILITIES: AppDataCapabilities = {
  provider: 'convex',
  supportsRealtime: true,
  supportsStreamResume: true,
  supportsChatPersistence: true,
  supportsFileMetadata: true,
  supportsFileUploads: true,
  supportsNotes: true,
  supportsProjects: true,
  supportsIntegrations: true,
  supportsSkills: true,
  supportsMcpServers: true,
  supportsSettings: true,
  supportsOnboarding: true,
  supportsUsageAccounting: true,
  supportsBillingRecords: true,
  supportsVectorSearch: true,
  supportsAutomations: true,
  supportsWebhooks: true,
  supportsApiKeys: true,
  supportsAccountDeletion: true,
  supportsBackgroundMaintenance: true,
  supportsManagedScheduler: true,
  supportsPersistentIdempotency: true,
  supportsServiceAuthReplayStore: true,
  requiresConvexClient: true,
}

function request(path: string, init: {
  body?: BodyInit | null
  headers?: HeadersInit
  method?: string
} = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return new NextRequest(`https://overlay.test${path}`, {
    body: init.body,
    headers,
    method: init.method,
  })
}

function context(): AppApiRouteContext {
  return {
    auth: {
      userId: 'user_1',
      accessToken: 'access_token',
      authType: 'session',
    },
    capabilities: deriveOverlayCapabilities(),
    params: Promise.resolve({}),
    parsedFormData: null,
    parsedJson: {},
    parsedQuery: {},
    appDataCapabilities: TEST_CONVEX_APP_DATA_CAPABILITIES,
    requestFingerprint: 'fixture-request-fingerprint',
    requestIdempotencyKey: 'fixture-idempotency-key',
    workspace: {
      workspace: {
        id: 'ws_personal_user_1',
        kind: 'personal',
        name: 'Personal',
        slug: 'personal-user_1',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
      },
      principal: {
        id: 'principal_1',
        workspaceId: 'ws_personal_user_1',
        type: 'human',
        displayName: 'Test User',
        createdAt: 0,
        updatedAt: 0,
      },
      membership: {
        membershipId: 'membership_1',
        workspaceId: 'ws_personal_user_1',
        principalId: 'principal_1',
        role: 'owner',
        status: 'active',
        joinedAt: 0,
        updatedAt: 0,
      },
    },
  }
}

function composioIntegrationService() {
  return new IntegrationService(new ComposioIntegrationProvider({
    apiKeyResolver: async () => 'test-composio-key',
  }))
}

function workspaceConnectorRepositoryFixture(): WorkspaceConnectorRepository {
  const rows = [{
    _id: 'mapping_1',
    workspaceId: 'ws_personal_user_1',
    userId: 'user_1',
    providerKey: 'gmail',
    connectedAccountId: 'ca_gmail',
    createdAt: 0,
    updatedAt: 0,
  }]
  return {
    listByWorkspace: async () => [{
      ...rows[0]!,
    }],
    listByUser: async () => rows,
    insert: async () => 'mapping_1',
    remove: async () => undefined,
    removeByUser: async () => 0,
  }
}

function permissiveAuthorizationService(): AuthorizationService {
  return {
    resolveSubject: async (userId: string) => ({
      userId,
      groupIds: [],
      roleIds: [],
      capabilities: [],
      isDeploymentOwner: false,
    }),
    checkResolvedCatalogResourceAccess: async ({ capability, resourceId, resourceType }) => ({
      allowed: true,
      capability,
      resourceId,
      resourceType,
      requiredAction: 'view',
      reason: 'resource_unrestricted',
    }),
    checkResolvedCapability: (_subject, capability) => ({
      allowed: true,
      capability,
      reason: 'capability_granted',
    }),
    filterCatalogResourceIds: async ({ resourceIds }) => [...resourceIds],
  } as unknown as AuthorizationService
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json()
}

test('files POST route preserves success response shape', async (t) => {
  t.mock.method(fileService, 'createFile', async () => ({ id: 'file_1', ids: undefined, parts: undefined }))
  const route = await import('./files/route')
  const response = await route.POST(
    request('/api/v1/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'x.txt' }),
    }),
    context(),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), { id: 'file_1' })
})

test('files upload-url and presign routes preserve success response shapes', async (t) => {
  t.mock.method(fileService, 'createUploadUrl', async () => ({
    uploadUrl: 'https://upload.test/file',
    r2Key: 'users/user_1/files/tmp/file.txt',
    expiresIn: 900,
    maxSizeBytes: 123,
  }))
  t.mock.method(fileService, 'createPresignedUpload', async () => ({
    presignedUrl: 'https://upload.test/presign',
    r2Key: 'users/user_1/files/tmp/presign.txt',
    expiresIn: 900,
    maxSizeBytes: 456,
  }))

  const uploadRoute = await import('./files/upload-url/route')
  const presignRoute = await import('./files/presign/route')

  const uploadResponse = await uploadRoute.POST(
    request('/api/v1/files/upload-url', {
      method: 'POST',
      body: JSON.stringify({ name: 'file.txt', sizeBytes: 123 }),
    }),
    context(),
  )
  assert.equal(uploadResponse.status, 200)
  assert.deepEqual(await readJson(uploadResponse), {
    uploadUrl: 'https://upload.test/file',
    r2Key: 'users/user_1/files/tmp/file.txt',
    expiresIn: 900,
    maxSizeBytes: 123,
  })

  const presignResponse = await presignRoute.GET(
    request('/api/v1/files/presign?name=presign.txt&sizeBytes=456', { method: 'GET' }),
    context(),
  )
  assert.equal(presignResponse.status, 200)
  assert.deepEqual(await readJson(presignResponse), {
    presignedUrl: 'https://upload.test/presign',
    r2Key: 'users/user_1/files/tmp/presign.txt',
    expiresIn: 900,
    maxSizeBytes: 456,
  })
})

test('files DELETE route preserves success response shape', async (t) => {
  t.mock.method(fileService, 'deleteFile', async () => ({ success: true as const }))
  const route = await import('./files/route')
  const response = await route.DELETE(
    request('/api/v1/files?fileId=file_1', { method: 'DELETE' }),
    context(),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), { success: true })
})

test('files DELETE route preserves missing fileId error shape', async () => {
  const route = await import('./files/route')
  const response = await route.DELETE(request('/api/v1/files', { method: 'DELETE' }), context())

  assert.equal(response.status, 400)
  assert.deepEqual(await readJson(response), { error: 'fileId required' })
})

test('generate-image rejects malformed request bodies before provider work', async () => {
  const route = await import('./generate-image/route')
  const response = await route.POST(
    request('/api/v1/generate-image', {
      method: 'POST',
      body: JSON.stringify({ prompt: 123 }),
    }),
    context(),
  )

  assert.equal(response.status, 400)
  const body = await readJson(response) as { error?: string; issues?: unknown[] }
  assert.equal(body.error, 'Invalid request')
  assert.ok(Array.isArray(body.issues))
})

test('generate-video rejects malformed request bodies before provider work', async () => {
  const route = await import('./generate-video/route')
  const response = await route.POST(
    request('/api/v1/generate-video', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'make a clip', videoSubMode: 'unsupported-mode' }),
    }),
    context(),
  )

  assert.equal(response.status, 400)
  const body = await readJson(response) as { error?: string; issues?: unknown[] }
  assert.equal(body.error, 'Invalid request')
  assert.ok(Array.isArray(body.issues))
})

test('projects POST rejects malformed request bodies before Convex work', async () => {
  const route = await import('./projects/route')
  const response = await route.POST(
    request('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 123 }),
    }),
    context(),
  )

  assert.equal(response.status, 400)
  const body = await readJson(response) as { error?: string; issues?: unknown[] }
  assert.equal(body.error, 'Invalid request')
  assert.ok(Array.isArray(body.issues))
})

test('conversations act keeps legacy missing messages error after schema validation', async () => {
  const route = await import('./conversations/act/route')
  const response = await route.POST(
    request('/api/v1/conversations/act', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    context(),
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await readJson(response), { error: 'messages required' })
})

test('automations GET route preserves list response shape', async (t) => {
  t.mock.method(convex, 'query', async (path: string) => {
    assert.equal(path, 'automations/automations:list')
    return []
  })
  const route = await import('./automations/route')
  const response = await route.GET(request('/api/v1/automations', { method: 'GET' }), context())

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), [])
})

test('integrations search reads Composio v3 toolkits and annotates connected state', async (t) => {
  const originalComposioApiKey = process.env.COMPOSIO_API_KEY
  const originalWorkosApiKey = process.env.WORKOS_API_KEY
  process.env.COMPOSIO_API_KEY = 'test-composio-key'
  delete process.env.WORKOS_API_KEY
  t.after(() => {
    if (originalComposioApiKey === undefined) {
      delete process.env.COMPOSIO_API_KEY
    } else {
      process.env.COMPOSIO_API_KEY = originalComposioApiKey
    }
    if (originalWorkosApiKey === undefined) {
      delete process.env.WORKOS_API_KEY
    } else {
      process.env.WORKOS_API_KEY = originalWorkosApiKey
    }
  })

  const seenUrls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    seenUrls.push(url.toString())
    if (url.pathname === '/api/v3/connected_accounts') {
      assert.equal(url.searchParams.get('user_ids'), 'user_1')
      return Response.json({
        items: [
          { id: 'ca_gmail', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
          { id: 'ca_github_pending', status: 'INITIALIZING', toolkit: { slug: 'github' } },
        ],
      })
    }
    if (url.pathname === '/api/v3/toolkits') {
      assert.equal(url.searchParams.get('search'), 'g')
      return Response.json({
        items: [
          {
            slug: 'gmail',
            name: 'Gmail',
            meta: {
              description: 'Email',
              logo: 'https://logos.composio.dev/api/gmail',
            },
          },
          {
            slug: 'github',
            name: 'GitHub',
            meta: {
              description: 'Code hosting',
              logo: 'https://logos.composio.dev/api/github',
            },
          },
        ],
        next_cursor: 'next-page',
      })
    }
    throw new Error(`Unexpected fetch ${url.toString()}`)
  })

  const route = await import('./integrations/route')
  const testContext = context()
  testContext.auth.accessToken = ''
  const response = await route.GET(
    request('/api/v1/integrations?action=search&q=g&limit=25'),
    testContext,
    { service: composioIntegrationService() },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), {
    data: [
      {
        slug: 'gmail',
        providerKey: 'gmail',
        provider: 'composio',
        name: 'Gmail',
        description: 'Email',
        logoUrl: 'https://logos.composio.dev/api/gmail',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'connected',
        isConnected: true,
        connectedAccountId: 'ca_gmail',
      },
      {
        slug: 'github',
        providerKey: 'github',
        provider: 'composio',
        name: 'GitHub',
        description: 'Code hosting',
        logoUrl: 'https://logos.composio.dev/api/github',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'not-connected',
        isConnected: false,
        connectedAccountId: null,
      },
    ],
    items: [
      {
        slug: 'gmail',
        providerKey: 'gmail',
        provider: 'composio',
        name: 'Gmail',
        description: 'Email',
        logoUrl: 'https://logos.composio.dev/api/gmail',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'connected',
        isConnected: true,
        connectedAccountId: 'ca_gmail',
      },
      {
        slug: 'github',
        providerKey: 'github',
        provider: 'composio',
        name: 'GitHub',
        description: 'Code hosting',
        logoUrl: 'https://logos.composio.dev/api/github',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'not-connected',
        isConnected: false,
        connectedAccountId: null,
      },
    ],
    provider: 'composio',
    providerCapabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
    nextCursor: 'next-page',
    hasMore: true,
    syncCursor: 'next-page',
  })
  assert.ok(seenUrls.every((url) => url.startsWith('https://backend.composio.dev/api/v3/')))
})

test('integrations default list reads Composio v3 connected accounts by user id', async (t) => {
  const originalComposioApiKey = process.env.COMPOSIO_API_KEY
  const originalWorkosApiKey = process.env.WORKOS_API_KEY
  process.env.COMPOSIO_API_KEY = 'test-composio-key'
  delete process.env.WORKOS_API_KEY
  t.after(() => {
    if (originalComposioApiKey === undefined) {
      delete process.env.COMPOSIO_API_KEY
    } else {
      process.env.COMPOSIO_API_KEY = originalComposioApiKey
    }
    if (originalWorkosApiKey === undefined) {
      delete process.env.WORKOS_API_KEY
    } else {
      process.env.WORKOS_API_KEY = originalWorkosApiKey
    }
  })

  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    if (url.pathname === '/api/v3/connected_accounts') {
      assert.equal(url.searchParams.get('user_ids'), 'user_1')
      return Response.json({
        items: [
          { id: 'ca_gmail', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
          { id: 'ca_gmail_2', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
          { id: 'ca_github_pending', status: 'INITIALIZING', toolkit: { slug: 'github' } },
        ],
      })
    }
    if (url.pathname === '/api/v3/toolkits/gmail') {
      return Response.json({
        slug: 'gmail',
        name: 'Gmail',
        meta: {
          description: 'Email',
          logo: 'https://logos.composio.dev/api/gmail',
        },
      })
    }
    throw new Error(`Unexpected fetch ${url.toString()}`)
  })

  const route = await import('./integrations/route')
  const testContext = context()
  testContext.auth.accessToken = ''
  const response = await route.GET(
    request('/api/v1/integrations'),
    testContext,
    {
      service: composioIntegrationService(),
      workspaceConnectors: workspaceConnectorRepositoryFixture(),
    },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), {
    connected: ['gmail'],
    data: [
      {
        slug: 'gmail',
        providerKey: 'gmail',
        provider: 'composio',
        name: 'Gmail',
        description: 'Email',
        logoUrl: 'https://logos.composio.dev/api/gmail',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'connected',
        isConnected: true,
        connectedAccountId: 'ca_gmail',
      },
    ],
    items: [
      {
        slug: 'gmail',
        providerKey: 'gmail',
        provider: 'composio',
        name: 'Gmail',
        description: 'Email',
        logoUrl: 'https://logos.composio.dev/api/gmail',
        capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
        authenticationState: 'connected',
        isConnected: true,
        connectedAccountId: 'ca_gmail',
      },
    ],
    provider: 'composio',
    providerCapabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
    hasMore: false,
  })
})

test('integrations claim only orphaned legacy connections for the Personal workspace', async () => {
  const mappings: Awaited<ReturnType<WorkspaceConnectorRepository['listByUser']>> = [{
    _id: 'mapping_github',
    workspaceId: 'ws_acme',
    userId: 'user_1',
    providerKey: 'github',
    connectedAccountId: 'ca_github',
    createdAt: 0,
    updatedAt: 0,
  }]
  const inserted: string[] = []
  const workspaceConnectors: WorkspaceConnectorRepository = {
    async listByWorkspace({ workspaceId }) {
      return mappings.filter((row) => row.workspaceId === workspaceId)
    },
    async listByUser() { return mappings },
    async insert(input) {
      inserted.push(input.providerKey)
      mappings.push({ _id: `mapping_${input.providerKey}`, ...input, createdAt: 1, updatedAt: 1 })
      return `mapping_${input.providerKey}`
    },
    async remove() {},
    async removeByUser() { return 0 },
  }
  const integration = (providerKey: string, id: string) => ({
    id,
    provider: 'composio',
    providerKey,
    userId: 'user_1',
    authenticationState: 'connected' as const,
  })
  const route = await import('./integrations/route')
  const response = await route.GET(request('/api/v1/integrations'), context(), {
    service: {
      id: 'composio',
      capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
      async listConnected() {
        return {
          connections: [
            integration('gmail', 'ca_gmail'),
            integration('gmail', 'ca_gmail_duplicate'),
            integration('github', 'ca_github'),
          ],
          items: [
            { providerKey: 'gmail', slug: 'gmail' },
            { providerKey: 'github', slug: 'github' },
          ],
        }
      },
    } as IntegrationService,
    workspaceConnectors,
  })

  assert.equal(response.status, 200)
  assert.deepEqual(inserted, ['gmail'])
  assert.deepEqual((await readJson(response)).connected, ['gmail'])
  assert.equal(mappings.find(({ providerKey }) => providerKey === 'github')?.workspaceId, 'ws_acme')
})

test('automations create/update/test/run preserve validation and auth error shapes', async (t) => {
  const automations = await import('./automations/route')
  const testRoute = await import('./automations/test/route')
  const runRoute = await import('./automations/run/route')

  const createResponse = await automations.POST(
    request('/api/v1/automations', { method: 'POST', body: JSON.stringify({}) }),
    context(),
  )
  assert.equal(createResponse.status, 400)
  assert.deepEqual(await readJson(createResponse), {
    error: 'name, description, instructions, and schedule are required',
  })

  const updateResponse = await automations.PATCH(
    request('/api/v1/automations', { method: 'PATCH', body: JSON.stringify({}) }),
    context(),
  )
  assert.equal(updateResponse.status, 400)
  assert.deepEqual(await readJson(updateResponse), { error: 'automationId required' })

  t.mock.method(automationService, 'updateAutomation', async (args: Parameters<typeof automationService.updateAutomation>[0]) => {
    assert.equal(args.userId, 'user_1')
    assert.deepEqual(args.body, {
      automationId: 'automation_1',
      schedule: { kind: 'interval', intervalMinutes: 45 },
    })
    return { success: true }
  })
  const updateContext = context()
  updateContext.parsedJson = {
    automationId: 'automation_1',
    schedule: { kind: 'interval', intervalMinutes: 45 },
  }
  const parsedBodyUpdateResponse = await automations.PATCH(
    request('/api/v1/automations', { method: 'PATCH', body: JSON.stringify({}) }),
    updateContext,
  )
  assert.equal(parsedBodyUpdateResponse.status, 200)
  assert.deepEqual(await readJson(parsedBodyUpdateResponse), { success: true })

  const testResponse = await testRoute.POST(
    request('/api/v1/automations/test', { method: 'POST', body: JSON.stringify({}) }),
    context(),
  )
  assert.equal(testResponse.status, 400)
  assert.deepEqual(await readJson(testResponse), { error: 'automationId required' })

  const runResponse = await runRoute.POST(
    request('/api/v1/automations/run', { method: 'POST', body: JSON.stringify({ runId: 'run_1' }) }),
  )
  assert.equal(runResponse.status, 401)
  assert.deepEqual(await readJson(runResponse), { error: 'Unauthorized' })

  t.mock.method(automationService, 'runAutomation', async (args: Parameters<typeof automationService.runAutomation>[0]) => {
    assert.equal(args.runId, 'run_1')
    assert.equal(args.serviceUserId, 'service_user_1')
    assert.equal(args.baseUrl, 'https://getoverlay.io')
    return { success: true, conversationId: 'conversation_1' as never }
  })
  const serviceContext = context()
  serviceContext.auth = {
    userId: 'service_user_1',
    accessToken: '',
    authType: 'service',
  }
  const serviceRunResponse = await runRoute.POST(
    request('/api/v1/automations/run', { method: 'POST', body: JSON.stringify({ runId: 'run_1' }) }),
    serviceContext,
  )
  assert.equal(serviceRunResponse.status, 200)
  assert.deepEqual(await readJson(serviceRunResponse), {
    success: true,
    conversationId: 'conversation_1',
  })
})

test('billing customer routes preserve unauthenticated/invalid body response shapes', async (t) => {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const context = getOverlayServerContext()
  t.mock.method(context.auth, 'getSession', async () => null)
  t.mock.method(context.auth, 'verifyAccessToken', async () => null)

  const subscription = await import('@/app/api/subscription/route')
  const settings = await import('@/app/api/subscription/settings/route')
  const checkout = await import('@/app/api/checkout/route')
  const topupHistory = await import('@/app/api/topups/history/route')
  const topupCheckout = await import('@/app/api/topups/checkout/route')
  const topupVerify = await import('@/app/api/topups/verify/route')
  const portal = await import('@/app/api/portal/route')
  const entitlements = await import('@/app/api/entitlements/route')

  const subscriptionResponse = await subscription.GET(request('/api/subscription?userId=user_1', { method: 'GET' }))
  assert.equal(subscriptionResponse.status, 401)
  assert.deepEqual(await readJson(subscriptionResponse), { error: 'Authentication required' })

  const settingsResponse = await settings.POST(
    request('/api/subscription/settings', { method: 'POST', body: 'null' }),
  )
  assert.equal(settingsResponse.status, 400)
  assert.deepEqual(await readJson(settingsResponse), { error: 'Invalid request body' })

  const checkoutResponse = await checkout.POST(
    request('/api/checkout', { method: 'POST', body: JSON.stringify({}) }),
  )
  assert.equal(checkoutResponse.status, 401)
  assert.deepEqual(await readJson(checkoutResponse), {
    error: 'Authentication required. Please sign in to subscribe.',
  })

  const topupHistoryResponse = await topupHistory.GET(request('/api/topups/history', { method: 'GET' }))
  assert.equal(topupHistoryResponse.status, 401)
  assert.deepEqual(await readJson(topupHistoryResponse), { error: 'Authentication required' })

  const topupCheckoutResponse = await topupCheckout.POST(
    request('/api/topups/checkout', { method: 'POST', body: JSON.stringify({}) }),
  )
  assert.equal(topupCheckoutResponse.status, 401)
  assert.deepEqual(await readJson(topupCheckoutResponse), { error: 'Authentication required' })

  const topupVerifyResponse = await topupVerify.POST(
    request('/api/topups/verify', { method: 'POST', body: JSON.stringify({ sessionId: 'cs_test_123' }) }),
  )
  assert.equal(topupVerifyResponse.status, 401)
  assert.deepEqual(await readJson(topupVerifyResponse), { error: 'Authentication required' })

  const portalResponse = await portal.POST(
    request('/api/portal', { method: 'POST', body: JSON.stringify({}) }),
  )
  assert.equal(portalResponse.status, 401)
  assert.deepEqual(await readJson(portalResponse), { error: 'Authentication required' })

  const entitlementsResponse = await entitlements.GET(request('/api/entitlements', { method: 'GET' }))
  assert.equal(entitlementsResponse.status, 401)
  assert.deepEqual(await readJson(entitlementsResponse), { error: 'Unauthorized' })
})

test('sensitive billing mutations require an interactive same-origin confirmation', async (t) => {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const { billingCheckoutService, billingCustomerService } = await import('@/server/billing/http')
  const server = getOverlayServerContext()
  t.mock.method(server.auth, 'getSession', async () => ({
    accessToken: 'session-access-token',
    user: { id: 'user_1', email: 'user@example.test' },
  }))
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
  t.mock.method(billingCustomerService, 'updateBillingSettings', async () => ({
    planKind: 'paid' as const,
    autoTopUpEnabled: false,
    topUpAmountCents: 800,
    autoTopUpAmountCents: 800,
    topUpMinAmountCents: 800,
    topUpMaxAmountCents: 20_000,
    topUpStepAmountCents: 100,
  }))
  t.mock.method(billingCheckoutService, 'createPortalSession', async () => ({
    url: 'https://billing.example.test/session',
  }))

  const settings = await import('@/app/api/subscription/settings/route')
  const portal = await import('@/app/api/portal/route')

  const missingOrigin = await settings.POST(request('/api/subscription/settings', {
    method: 'POST',
    body: JSON.stringify({
      autoTopUpEnabled: false,
      confirmation: 'UPDATE_BILLING_SETTINGS',
      topUpAmountCents: 800,
    }),
  }))
  assert.equal(missingOrigin.status, 403)

  const settingsResponse = await settings.POST(request('/api/subscription/settings', {
    method: 'POST',
    headers: { Origin: 'https://overlay.test', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({
      autoTopUpEnabled: false,
      confirmation: 'UPDATE_BILLING_SETTINGS',
      topUpAmountCents: 800,
    }),
  }))
  assert.equal(settingsResponse.status, 200)

  const portalResponse = await portal.POST(request('/api/portal', {
    method: 'POST',
    headers: { Origin: 'https://overlay.test', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ confirmation: 'OPEN_BILLING_PORTAL' }),
  }))
  assert.equal(portalResponse.status, 200)
  assert.deepEqual(await readJson(portalResponse), {
    url: 'https://billing.example.test/session',
  })
})

test('conversations act preserves premium gating response shape for free users', async (t) => {
  t.mock.method(convex, 'query', async (path: string) => {
    if (path === 'platform/usage:getEntitlementsByServer') {
      return {
        tier: 'free',
        planKind: 'free',
        creditsUsed: 0,
        creditsTotal: 0,
        budgetUsedCents: 0,
        budgetTotalCents: 0,
        budgetRemainingCents: 0,
      }
    }
    if (path === 'platform/uiSettings:getByServer') {
      return null
    }
    throw new Error(`Unexpected Convex query: ${path}`)
  })

  const route = await import('./conversations/act/route')
  const response = await route.POST(
    request('/api/v1/conversations/act', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        modelId: 'claude-sonnet-4-6',
      }),
    }),
    context(),
    { authorizationService: permissiveAuthorizationService() },
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await readJson(response), {
    error: 'premium_model_not_allowed',
    message: 'Free tier is limited to free models. Upgrade to a paid plan to use premium models.',
  })
})

test('conversations act swallows user-message persistence failure before later fatal preparation errors', async (t) => {
  let sawUserMessagePersist = false
  t.mock.method(convex, 'query', async (path: string) => {
    if (path === 'platform/usage:getEntitlementsByServer') {
      return {
        tier: 'free',
        planKind: 'free',
        creditsUsed: 0,
        creditsTotal: 0,
        budgetUsedCents: 0,
        budgetTotalCents: 0,
        budgetRemainingCents: 0,
      }
    }
    if (path === 'platform/uiSettings:getByServer') return null
    if (path === 'knowledge/memories:list') return []
    if (path === 'integrations/skills:list') return []
    if (path === 'integrations/mcpServers:listEnabled') return []
    if (path === 'chat/conversations:get') return null
    if (path === 'chat/conversations:getMessages') {
      throw new Error('history unavailable')
    }
    throw new Error(`Unexpected Convex query: ${path}`)
  })
  t.mock.method(convex, 'mutation', async (path: string) => {
    if (path === 'chat/conversations:addMessage') {
      sawUserMessagePersist = true
      throw new Error('user message persistence failed')
    }
    throw new Error(`Unexpected Convex mutation: ${path}`)
  })

  const route = await import('./conversations/act/route')
  const response = await route.POST(
    request('/api/v1/conversations/act', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conversation_1',
        turnId: 'turn_1',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        modelId: 'openrouter/free',
      }),
    }),
    context(),
    { authorizationService: permissiveAuthorizationService() },
  )

  assert.equal(sawUserMessagePersist, true)
  assert.equal(response.status, 500)
  const body = await readJson(response) as { error?: unknown; requestId?: unknown }
  assert.equal(body.error, 'history unavailable')
  assert.equal(typeof body.requestId, 'string')
})
