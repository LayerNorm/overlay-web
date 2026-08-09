import assert from 'node:assert/strict'
import test from 'node:test'
import { createOverlayAppClient } from './index'

interface RecordedRequest {
  input: RequestInfo | URL
  init?: RequestInit
}

function createRecordedClient() {
  const calls: RecordedRequest[] = []
  const client = createOverlayAppClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  })
  return { calls, client }
}

async function jsonBody(call: RecordedRequest): Promise<unknown> {
  assert.equal(typeof call.init?.body, 'string')
  return JSON.parse(call.init?.body as string)
}

test('file methods preserve route paths, methods, queries, and JSON bodies', async () => {
  const { calls, client } = createRecordedClient()

  await client.files.uploadUrlResponse({ name: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 42 })
  await client.files.presignResponse({ name: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 42 })
  await client.files.shareResponse({ fileId: 'file_1', visibility: 'public' })
  await client.files.searchTextResponse({ fileIds: ['file_1'], query: 'alpha' })
  await client.files.getResponse({ limit: 100, summary: true })

  assert.equal(String(calls[0]!.input), 'https://example.test/api/v1/files/upload-url')
  assert.equal(calls[0]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[0]!), {
    name: 'plan.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 42,
  })

  assert.equal(
    String(calls[1]!.input),
    'https://example.test/api/v1/files/presign?name=plan.pdf&mimeType=application%2Fpdf&sizeBytes=42',
  )
  assert.equal(calls[1]!.init?.method, undefined)

  assert.equal(String(calls[2]!.input), 'https://example.test/api/v1/files/share')
  assert.equal(calls[2]!.init?.method, 'PATCH')
  assert.deepEqual(await jsonBody(calls[2]!), { fileId: 'file_1', visibility: 'public' })

  assert.equal(String(calls[3]!.input), 'https://example.test/api/v1/files/search-text')
  assert.equal(calls[3]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[3]!), { fileIds: ['file_1'], query: 'alpha' })

  assert.equal(String(calls[4]!.input), 'https://example.test/api/v1/files?limit=100&summary=true')
  assert.equal(calls[4]!.init?.method, undefined)
})

test('file mutations accept null parent and project IDs', async () => {
  const { calls, client } = createRecordedClient()

  await client.files.createResponse({
    name: 'Root folder',
    type: 'folder',
    kind: 'folder',
    parentId: null,
    projectId: null,
  })
  await client.files.updateResponse({
    fileId: 'folder_1',
    parentId: null,
    projectId: null,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(await jsonBody(calls[0]!), {
    name: 'Root folder',
    type: 'folder',
    kind: 'folder',
    parentId: null,
    projectId: null,
  })
  assert.deepEqual(await jsonBody(calls[1]!), {
    fileId: 'folder_1',
    parentId: null,
    projectId: null,
  })
})

test('module feature methods use canonical app endpoints', async () => {
  const { calls, client } = createRecordedClient()

  await client.conversations.streamAuthResponse({ conversationId: 'conv_1' })
  await client.conversations.actResponse({ conversationId: 'conv_1', messages: [] })
  await client.conversations.extensionPlanResponse({ prompt: 'Plan this' })
  await client.chat.browserTaskResponse({ task: 'Open the docs' })
  await client.chat.generateTabGroupLabelResponse({ tabs: [{ title: 'Docs' }] })
  await client.chat.generateImageResponse({ prompt: 'A clean diagram' })
  await client.chat.generateVideoResponse({ prompt: 'A clean demo' })
  await client.chat.transcribeResponse(new FormData())
  await client.memory.updateResponse({ memoryId: 'mem_1', content: 'Updated' })
  await client.outputs.deleteResponse({ outputId: 'out_1' })
  await client.notes.notebookAgentResponse({
    noteContent: '',
    noteTitle: 'Untitled',
    message: 'summarize this',
  })
  await client.projects.getResponse({ projectId: 'proj_1', includeDeleted: true, updatedSince: 123 })
  await client.integrations.connectResponse({ toolkit: 'github' })
  await client.skills.deleteResponse({ skillId: 'skill_1' })
  await client.mcpServers.testResponse({ url: 'https://mcp.example.test', transport: 'streamable-http' })
  await client.automations.updateResponse({ automationId: 'auto_1', name: 'Renamed' })
  await client.automations.testResponse({ automationId: 'auto_1' })
  await client.automations.getRuns('auto_1')

  assert.equal(String(calls[0]!.input), 'https://example.test/api/v1/conversations/stream-auth')
  assert.equal(calls[0]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[0]!), { conversationId: 'conv_1' })

  assert.equal(String(calls[1]!.input), 'https://example.test/api/v1/conversations/act')
  assert.equal(calls[1]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[1]!), { conversationId: 'conv_1', messages: [] })

  assert.equal(String(calls[2]!.input), 'https://example.test/api/v1/conversations/act/extension-plan')
  assert.equal(calls[2]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[2]!), { prompt: 'Plan this' })

  assert.equal(String(calls[3]!.input), 'https://example.test/api/v1/browser-task')
  assert.equal(calls[3]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[3]!), { task: 'Open the docs' })

  assert.equal(String(calls[4]!.input), 'https://example.test/api/v1/generate-tab-group-label')
  assert.equal(calls[4]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[4]!), { tabs: [{ title: 'Docs' }] })

  assert.equal(String(calls[5]!.input), 'https://example.test/api/v1/generate-image')
  assert.equal(calls[5]!.init?.method, 'POST')

  assert.equal(String(calls[6]!.input), 'https://example.test/api/v1/generate-video')
  assert.equal(calls[6]!.init?.method, 'POST')

  assert.equal(String(calls[7]!.input), 'https://example.test/api/v1/transcribe')
  assert.equal(calls[7]!.init?.method, 'POST')

  assert.equal(String(calls[8]!.input), 'https://example.test/api/v1/memory')
  assert.equal(calls[8]!.init?.method, 'PATCH')
  assert.deepEqual(await jsonBody(calls[8]!), { memoryId: 'mem_1', content: 'Updated' })

  assert.equal(String(calls[9]!.input), 'https://example.test/api/v1/outputs?outputId=out_1')
  assert.equal(calls[9]!.init?.method, 'DELETE')

  assert.equal(String(calls[10]!.input), 'https://example.test/api/v1/notebook-agent')
  assert.equal(calls[10]!.init?.method, 'POST')

  assert.equal(
    String(calls[11]!.input),
    'https://example.test/api/v1/projects?projectId=proj_1&includeDeleted=true&updatedSince=123',
  )

  assert.equal(String(calls[12]!.input), 'https://example.test/api/v1/integrations')
  assert.equal(calls[12]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[12]!), { toolkit: 'github', action: 'connect' })

  assert.equal(String(calls[13]!.input), 'https://example.test/api/v1/skills?skillId=skill_1')
  assert.equal(calls[13]!.init?.method, 'DELETE')

  assert.equal(String(calls[14]!.input), 'https://example.test/api/v1/mcps/test')
  assert.equal(calls[14]!.init?.method, 'POST')

  assert.equal(String(calls[15]!.input), 'https://example.test/api/v1/automations')
  assert.equal(calls[15]!.init?.method, 'PATCH')
  assert.deepEqual(await jsonBody(calls[15]!), { automationId: 'auto_1', name: 'Renamed' })

  assert.equal(String(calls[16]!.input), 'https://example.test/api/v1/automations/test')
  assert.equal(calls[16]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[16]!), { automationId: 'auto_1' })

  assert.equal(
    String(calls[17]!.input),
    'https://example.test/api/v1/automations?automationId=auto_1&includeRuns=true',
  )
})

test('automation run history unwraps the standardized paginated envelope', async () => {
  const client = createOverlayAppClient({
    baseUrl: 'https://example.test',
    fetch: async () => Response.json({
      data: [{ _id: 'run_1', status: 'completed', scheduledFor: 123 }],
      hasMore: false,
      total: 1,
    }),
  })

  const runs = await client.automations.getRuns('auto_1')

  assert.deepEqual(runs, [{ _id: 'run_1', status: 'completed', scheduledFor: 123 }])
})

test('webhook helpers unwrap standardized lists and parse mutation payloads', async () => {
  const client = createOverlayAppClient({
    baseUrl: 'https://example.test',
    fetch: async (input) => {
      const url = String(input)
      if (url.includes('view=deliveries')) {
        return Response.json({
          data: [{ _id: 'delivery_1', status: 'delivered' }],
          hasMore: false,
        })
      }
      return Response.json({
        data: [{ _id: 'subscription_1', events: ['chat.completed'] }],
        hasMore: false,
      })
    },
  })

  assert.deepEqual(await client.webhooks.list(), [
    { _id: 'subscription_1', events: ['chat.completed'] },
  ])
  assert.deepEqual(await client.webhooks.listDeliveries(), [
    { _id: 'delivery_1', status: 'delivered' },
  ])
  assert.deepEqual(
    await client.webhooks.parseCreateResponse(Response.json({
      id: 'subscription_1', secret: 'secret_1',
    })),
    { id: 'subscription_1', secret: 'secret_1' },
  )
  assert.deepEqual(
    await client.webhooks.parseRotateSecretResponse(Response.json({ secret: 'secret_2' })),
    { secret: 'secret_2' },
  )
})

test('list helpers unwrap paginated envelopes while getPage preserves metadata', async () => {
  const calls: RecordedRequest[] = []
  const client = createOverlayAppClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        data: [{ _id: 'proj_1', name: 'Alpha', createdAt: 1, updatedAt: 2 }],
        nextCursor: 'next',
        hasMore: true,
        total: 2,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const list = await client.projects.get<Array<{ _id: string; name: string }>>({ limit: 1, sort: 'name', order: 'asc' })
  assert.deepEqual(list, [{ _id: 'proj_1', name: 'Alpha', createdAt: 1, updatedAt: 2 }])
  assert.equal(String(calls[0]!.input), 'https://example.test/api/v1/projects?limit=1&sort=name&order=asc')

  const page = await client.projects.getPage<{ _id: string; name: string }>({ cursor: 'next' })
  assert.equal(page.hasMore, true)
  assert.equal(page.nextCursor, 'next')
  assert.deepEqual(page.data, [{ _id: 'proj_1', name: 'Alpha', createdAt: 1, updatedAt: 2 }])
})

test('settings and account methods preserve billing/auth route contracts', async () => {
  const { calls, client } = createRecordedClient()

  await client.account.entitlementsResponse()
  await client.account.desktopLinkResponse({ codeChallenge: 'challenge', chromeExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
  await client.billing.portalResponse({
    confirmation: 'OPEN_BILLING_PORTAL',
    sessionId: 'cs_123',
  })
  await client.billing.verifyCheckoutResponse({ sessionId: 'cs_123' })
  await client.subscription.updateSettingsResponse({
    autoTopUpEnabled: true,
    confirmation: 'UPDATE_BILLING_SETTINGS',
    topUpAmountCents: 1200,
    grantOffSessionConsent: true,
  })
  await client.topUps.historyResponse()
  await client.topUps.checkoutResponse({ amountCents: 1200, autoTopUpEnabled: true, returnPath: '/account' })
  await client.topUps.verifyResponse({ sessionId: 'cs_topup' })

  assert.equal(String(calls[0]!.input), 'https://example.test/api/entitlements')

  assert.equal(String(calls[1]!.input), 'https://example.test/api/auth/desktop-link')
  assert.equal(calls[1]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[1]!), {
    codeChallenge: 'challenge',
    chromeExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })

  assert.equal(String(calls[2]!.input), 'https://example.test/api/portal')
  assert.equal(calls[2]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[2]!), {
    confirmation: 'OPEN_BILLING_PORTAL',
    sessionId: 'cs_123',
  })

  assert.equal(String(calls[3]!.input), 'https://example.test/api/checkout/verify')
  assert.equal(calls[3]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[3]!), { sessionId: 'cs_123' })

  assert.equal(String(calls[4]!.input), 'https://example.test/api/v1/subscription/settings')
  assert.equal(calls[4]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[4]!), {
    autoTopUpEnabled: true,
    confirmation: 'UPDATE_BILLING_SETTINGS',
    topUpAmountCents: 1200,
    grantOffSessionConsent: true,
  })

  assert.equal(String(calls[5]!.input), 'https://example.test/api/topups/history')

  assert.equal(String(calls[6]!.input), 'https://example.test/api/topups/checkout')
  assert.equal(calls[6]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[6]!), {
    amountCents: 1200,
    autoTopUpEnabled: true,
    returnPath: '/account',
  })

  assert.equal(String(calls[7]!.input), 'https://example.test/api/topups/verify')
  assert.equal(calls[7]!.init?.method, 'POST')
  assert.deepEqual(await jsonBody(calls[7]!), { sessionId: 'cs_topup' })
})

test('mutation helpers send Idempotency-Key when idempotencyKey is set', async () => {
  const { calls, client } = createRecordedClient()
  const key = 'conv-create-abc'

  await client.conversations.createResponse(
    { title: 'Test', lastMode: 'act' },
    { idempotencyKey: key },
  )
  await client.conversations.addMessageResponse(
    { conversationId: 'c1', turnId: 't1', mode: 'act', role: 'user', content: 'hi' },
    { idempotencyKey: 'turn-t1' },
  )
  await client.files.createResponse({ name: 'doc.txt', type: 'file' }, { idempotencyKey: 'file-1' })

  assert.equal(new Headers(calls[0]!.init?.headers).get('Idempotency-Key'), key)
  assert.equal(new Headers(calls[1]!.init?.headers).get('Idempotency-Key'), 'turn-t1')
  assert.equal(new Headers(calls[2]!.init?.headers).get('Idempotency-Key'), 'file-1')
})
