import { expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { splitUserDisplayText } from '@overlay/chat-core/messages'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { GET } from './route'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ messages: vi.fn() }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: {
  conversations: {
    getConversationById: async () => ({ conversationType: 'group' }),
    getNativeThreadCompatibility: async () => ({ status: 'writable', readOnly: false }),
  },
  conversationCollaboration: { listMessages: mocks.messages },
} } }) }))

const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES, requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}

test('room history retains human document markers alongside structured image parts after reload', async () => {
  const content = 'Read these attachments\n\n[Indexed documents: brief.txt]'
  const parts = [{ type: 'text', text: 'Read these attachments' },
    { type: 'file', url: 'https://example.test/image.png', mediaType: 'image/png', fileName: 'image.png' }]
  mocks.messages.mockResolvedValue([
    { _id: 'human', turnId: 'turn', role: 'user', authorKind: 'human', content, parts, createdAt: 1 },
    { _id: 'assistant', role: 'assistant', authorKind: 'agent', content: 'Legacy assistant content',
      parts: [{ type: 'text', text: 'Structured answer' }], createdAt: 2 },
  ])
  const response = await GET(new NextRequest('https://example.test/api/v1/conversations?conversationId=room&messages=true'), context)
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.messages[0].content).toBe(content)
  expect(splitUserDisplayText(result.messages[0].content)).toEqual({ bodyText: 'Read these attachments', docNames: ['brief.txt'] })
  expect(result.messages[0].parts).toEqual(parts)
  expect(result.messages[1].content).toBeUndefined()
  expect(result.messages[1].parts).toEqual([{ type: 'text', text: 'Structured answer' }])
})
