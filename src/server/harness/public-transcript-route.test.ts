import { NextRequest } from 'next/server'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: mocks }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'fixture-secret' }))
import { GET } from '@/server/app-api/v1/conversations/trace/route'
const context = { auth: { userId: 'alice' }, workspace: { workspace: { id: 'workspace' } } } as AppApiRouteContext
beforeEach(() => vi.resetAllMocks())

test('trace route resolves only a message using the authenticated actor and workspace', async () => {
  mocks.query.mockResolvedValue({ steps: [], nextSequence: null })
  const response = await GET(new NextRequest('https://example.test/api/v1/conversations/trace?messageId=message&actorUserId=bob&runId=foreign'), context)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/x-ndjson')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith('harness/runs:listMessageTranscriptSteps', {
    actorUserId: 'alice', workspaceId: 'workspace', messageId: 'message', serverSecret: 'fixture-secret',
  }, { throwOnError: true })
  expect(await response.text()).toContain('"type":"done"')
})

test('missing or inaccessible traces are not exposed', async () => {
  const request = new NextRequest('https://example.test/api/v1/conversations/trace?messageId=message')
  mocks.query.mockResolvedValueOnce(null)
  expect((await GET(request, context)).status).toBe(404)
  mocks.query.mockRejectedValueOnce(new Error('CONVERSATION_ACCESS_DENIED'))
  expect((await GET(request, context)).status).toBe(404)
  expect((await GET(new NextRequest('https://example.test/api/v1/conversations/trace'), context)).status).toBe(400)
})
