import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

const mocks = vi.hoisted(() => ({ ensureBudgetNotLow: vi.fn(), charge: vi.fn(), reserve: vi.fn(), fetch: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/server/ai/gateway/server-provider-keys', () => ({ getServerProviderKey: async () => 'groq-key' }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    generationUsagePolicy: {
      getEntitlements: async () => ({ tier: 'pro', planKind: 'paid', creditsUsed: 0, creditsTotal: 100,
        budgetUsedCents: 0, budgetTotalCents: 10_000, budgetRemainingCents: 10_000, localTranscriptionEnabled: true }),
      ensureBudgetNotLow: mocks.ensureBudgetNotLow,
      charge: mocks.charge,
      reserve: mocks.reserve,
    },
  }),
}))

import { POST } from './route'

const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}

function request() {
  const form = new FormData()
  form.append('audio', new File([new Uint8Array(16)], 'clip.m4a', { type: 'audio/mp4' }))
  return new NextRequest('https://example.test/api/v1/transcribe', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => vi.unstubAllGlobals())

test('a workspace under 2% after a failed top-up is refused before the provider is called', async () => {
  mocks.ensureBudgetNotLow.mockResolvedValue({ ok: false, status: 402, code: 'insufficient_budget', payload: { message: 'low' } })
  const response = await POST(request(), context)
  expect(response.status).toBe(402)
  expect(await response.json()).toMatchObject({ error: 'insufficient_budget', message: 'low' })
  expect(mocks.ensureBudgetNotLow).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'transcription', userId: 'owner', workspaceId: 'workspace',
  }))
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.charge).not.toHaveBeenCalled()
})

test('a finished transcription is charged its reported duration directly, with nothing reserved', async () => {
  mocks.ensureBudgetNotLow.mockResolvedValue({ ok: true, entitlements: {} })
  mocks.fetch.mockResolvedValue(Response.json({ text: 'hello', duration: 30 }))
  mocks.charge.mockResolvedValue({ budgetLow: false })
  const response = await POST(request(), context)
  expect(await response.json()).toEqual({ text: 'hello' })
  expect(mocks.charge).toHaveBeenCalledTimes(1)
  expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner', workspaceId: 'workspace', operationId: expect.stringMatching(/^audio\.transcribe:/),
    usage: expect.objectContaining({ kind: 'transcription', durationSeconds: 30 }),
  }))
  expect(mocks.charge.mock.calls[0][0].providerCostUsd).toBeGreaterThan(0)
  expect(mocks.charge.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.fetch.mock.invocationCallOrder[0]!)
  expect(mocks.reserve).not.toHaveBeenCalled()
})

test('a failed provider call charges nothing', async () => {
  mocks.ensureBudgetNotLow.mockResolvedValue({ ok: true, entitlements: {} })
  mocks.fetch.mockResolvedValue(new Response('bad audio', { status: 400 }))
  const response = await POST(request(), context)
  expect(response.status).toBe(500)
  expect(mocks.charge).not.toHaveBeenCalled()
  expect(mocks.reserve).not.toHaveBeenCalled()
})
