import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  paginate: vi.fn(),
  conversationId: 'a'.repeat(32),
  parallelReads: true,
}))
vi.mock('./usePersonalChatRouteSelection', () => ({
  usePersonalChatRouteSelection: () => ({
    selectedConversationId: mocks.conversationId, conversationId: mocks.conversationId,
    viewerUserId: 'viewer', setPendingTranscriptConversation: () => false,
  }),
  canSetPendingTranscript: vi.fn(), pendingIntentMatches: vi.fn(), pendingTranscriptInvalid: vi.fn(),
  selectedChatIdFromRouteEvent: vi.fn(),
}))
vi.mock('./usePublicStreamMetrics', () => ({ usePublicStreamMetrics: () => {} }))
vi.mock('convex/react', () => ({
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(query) === 'chat/personal:getSummary') return mocks.summary
    if (getFunctionName(query) === 'platform/uiSettings:mine') return mocks.parallelReads ? { personalChatParallelReadsRevision: 'parallel-reads-v1' } : {}
    return undefined
  },
  usePaginatedQuery: mocks.paginate,
}))

import { usePersonalChatTranscript } from './usePersonalChatTranscript'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
afterEach(() => vi.unstubAllGlobals())

test('message subscription starts before summary, but rows stay hidden until current scope is authorized', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.summary = undefined
  mocks.parallelReads = true
  mocks.conversationId = 'a'.repeat(32)
  const message = { _id: 'message', conversationId: mocks.conversationId, status: 'completed', content: 'Authorized content' }
  mocks.paginate.mockReturnValue({ results: [{ message, contextUser: null, outputs: [] }], status: 'Exhausted', loadMore: vi.fn() })
  let observed!: ReturnType<typeof usePersonalChatTranscript>
  function Consumer() {
    const result = usePersonalChatTranscript({ workspaceId: 'workspace', canQuery: true, canRead: true, pathname: '/app/chat', routeId: mocks.conversationId })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<Consumer />) })
    expect(mocks.paginate.mock.lastCall?.[1]).toEqual({ workspaceId: 'workspace', conversationId: mocks.conversationId, unavailableAsEmpty: true })
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.status).toBe('loading')
    mocks.summary = { _id: mocks.conversationId, workspaceId: 'workspace' }
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toHaveLength(1)
    expect(observed.transcript.status).toBe('ready')
    mocks.summary = null
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.status).toBe('unavailable')
    mocks.conversationId = 'b'.repeat(32)
    mocks.summary = { _id: mocks.conversationId, workspaceId: 'workspace' }
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})

test('web-first rollout uses the unchanged legacy request until the backend advertises support', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.summary = undefined
  mocks.parallelReads = false
  mocks.conversationId = 'a'.repeat(32)
  mocks.paginate.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() })
  function Consumer() {
    usePersonalChatTranscript({ workspaceId: 'workspace', canQuery: true, canRead: true, pathname: '/app/chat', routeId: mocks.conversationId })
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<Consumer />) })
    expect(mocks.paginate.mock.lastCall?.[1]).toBe('skip')
    mocks.summary = { _id: mocks.conversationId, workspaceId: 'workspace' }
    await act(() => renderer.update(<Consumer />))
    expect(mocks.paginate.mock.lastCall?.[1]).toEqual({ workspaceId: 'workspace', conversationId: mocks.conversationId })
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})
