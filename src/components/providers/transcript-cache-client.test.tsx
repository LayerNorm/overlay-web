import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  paginate: vi.fn(),
  queryCalls: [] as { name: string; args: unknown }[],
}))
vi.mock('./usePublicStreamMetrics', () => ({ usePublicStreamMetrics: () => {} }))
vi.mock('convex/react', () => ({
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(query)
    mocks.queryCalls.push({ name, args })
    if (name === 'chat/personal:getSummary') return mocks.summary
    if (name === 'platform/uiSettings:mine') return { personalChatParallelReadsRevision: 'parallel-reads-v1' }
    return undefined
  },
  usePaginatedQuery: mocks.paginate,
}))

import { usePersonalConversationTranscript } from './usePersonalConversationTranscript'
import { prefetchTranscript, transcriptCache, TranscriptCacheScopeProvider } from './transcript-cache-client'
import { transcriptCacheKey } from '@/shared/chat/transcript-cache'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  mocks.summary = undefined
  mocks.queryCalls.length = 0
  mocks.paginate.mockReset()
  transcriptCache.setIdentity(null)
})

const scope = { userId: 'user', workspaceId: 'workspace' }
const conversationId = 'n'.repeat(32)
const personalKey = transcriptCacheKey(scope, { kind: 'personal', conversationId })
const row = (id: string, content: string) => ({ message: { _id: id, conversationId, role: 'assistant', status: 'completed', content, parts: [] }, contextUser: null, outputs: [] })
const summary = { _id: conversationId, workspaceId: 'workspace', title: 'Cached' }
const noClient = {} as ConvexReactClient

test('a revisited conversation paints its remembered rows, then live rows replace them and are written back on leave', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  transcriptCache.setIdentity(scope)
  transcriptCache.put(personalKey, { items: [row('m2', 'remembered'), row('m1', 'first')], summary, isDone: false, source: 'live' })
  mocks.paginate.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() })
  let observed!: ReturnType<typeof usePersonalConversationTranscript>
  function Consumer({ id }: { id: string | null }) {
    const result = usePersonalConversationTranscript({ workspaceId: 'workspace', conversationId: id, canQuery: true, canRead: true })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  const tree = (id: string | null) => (
    <TranscriptCacheScopeProvider client={noClient} userId="user" workspaceId="workspace"><Consumer id={id} /></TranscriptCacheScopeProvider>
  )
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(tree(conversationId)) })
    expect(observed.transcript).toMatchObject({ status: 'ready', restored: true, hasMore: true, conversationId })
    expect(observed.transcript.rows.map(item => item.message._id)).toEqual(['m2', 'm1'])
    expect(observed.selectedSummary).toEqual(summary)
    expect(mocks.paginate.mock.calls.at(-1)![2]).toEqual({ initialNumItems: 50 })

    mocks.summary = summary
    mocks.paginate.mockReturnValue({ results: [row('m3', 'live reply'), row('m2', 'remembered')], status: 'Exhausted', loadMore: vi.fn() })
    await act(() => renderer.update(tree(conversationId)))
    expect(observed.transcript.restored).toBe(false)
    expect(observed.transcript.rows.map(item => item.message._id)).toEqual(['m3', 'm2'])

    await act(() => renderer.update(tree(null)))
    const written = transcriptCache.get<{ message: { _id: string } }, unknown>(personalKey)!
    expect(written.items.map(item => item.message._id)).toEqual(['m3', 'm2'])
    expect(written).toMatchObject({ isDone: true, source: 'live' })
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})

test('a conversation found unavailable is evicted and never shown from cache', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  transcriptCache.setIdentity(scope)
  transcriptCache.put(personalKey, { items: [row('m1', 'secret')], summary, isDone: true, source: 'live' })
  mocks.summary = null
  mocks.paginate.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() })
  let observed!: ReturnType<typeof usePersonalConversationTranscript>
  function Consumer() {
    const result = usePersonalConversationTranscript({ workspaceId: 'workspace', conversationId, canQuery: true, canRead: true })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => {
      renderer = create(<TranscriptCacheScopeProvider client={noClient} userId="user" workspaceId="workspace"><Consumer /></TranscriptCacheScopeProvider>)
    })
    expect(observed.transcript.status).toBe('unavailable')
    expect(observed.transcript.rows).toEqual([])
    expect(transcriptCache.get(personalKey)).toBeNull()
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})

test('another workspace or user never reads the entry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  transcriptCache.setIdentity(scope)
  transcriptCache.put(personalKey, { items: [row('m1', 'secret')], summary, isDone: true, source: 'live' })
  mocks.paginate.mockReturnValue({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() })
  let observed!: ReturnType<typeof usePersonalConversationTranscript>
  function Consumer() {
    const result = usePersonalConversationTranscript({ workspaceId: 'workspace', conversationId, canQuery: true, canRead: true })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => {
      renderer = create(<TranscriptCacheScopeProvider client={noClient} userId="other" workspaceId="workspace"><Consumer /></TranscriptCacheScopeProvider>)
    })
    expect(observed.transcript.restored).toBe(false)
    expect(observed.transcript.rows).toEqual([])
    expect(transcriptCache.stats().entries).toBe(0)
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})

function deferredClient() {
  const calls: { name: string; args: unknown; resolve(value: unknown): void }[] = []
  const client = {
    query: (query: Parameters<typeof getFunctionName>[0], args: unknown) => new Promise((resolve) => {
      calls.push({ name: getFunctionName(query), args, resolve })
    }),
  } as unknown as ConvexReactClient
  return { client, calls }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('prefetch reads the first page once, stores it for the hook, and only queries', async () => {
  transcriptCache.setIdentity(scope)
  const { client, calls } = deferredClient()
  prefetchTranscript(client, scope, { kind: 'personal', conversationId })
  prefetchTranscript(client, scope, { kind: 'personal', conversationId })
  expect(calls.map(call => call.name)).toEqual(['chat/personal:getSummary'])
  calls[0]!.resolve(summary)
  await flush()
  expect(calls[1]).toMatchObject({
    name: 'chat/personal:getMessages',
    args: { workspaceId: 'workspace', conversationId, paginationOpts: { numItems: 50, cursor: null } },
  })
  calls[1]!.resolve({ page: [row('m1', 'hello')], isDone: true, continueCursor: '' })
  await flush()
  expect(transcriptCache.get(personalKey)).toMatchObject({ source: 'prefetch', loadedCount: 1, isDone: true, summary })
  prefetchTranscript(client, scope, { kind: 'personal', conversationId })
  expect(calls).toHaveLength(2)
})

test('prefetch discards a result that lands after an identity change, and evicts an unavailable room', async () => {
  transcriptCache.setIdentity(scope)
  const { client, calls } = deferredClient()
  prefetchTranscript(client, scope, { kind: 'personal', conversationId })
  transcriptCache.setIdentity({ userId: 'user', workspaceId: 'other' })
  transcriptCache.setIdentity(scope)
  calls[0]!.resolve(summary)
  await flush()
  expect(calls).toHaveLength(1)
  expect(transcriptCache.get(personalKey)).toBeNull()

  const roomId = 'r'.repeat(32)
  const roomKey = transcriptCacheKey(scope, { kind: 'room', conversationId: roomId })
  prefetchTranscript(client, scope, { kind: 'room', conversationId: roomId })
  transcriptCache.put(roomKey, { items: [], summary: {}, isDone: true, source: 'live' })
  await flush()
  calls.at(-1)!.resolve(null)
  await flush()
  expect(calls.at(-1)!.name).toBe('collaboration/rooms:access')
  expect(transcriptCache.get(roomKey)).toBeNull()
})

test('prefetch runs at most two reads at once and skips ids that are not documents', async () => {
  transcriptCache.setIdentity(scope)
  const { client, calls } = deferredClient()
  for (const letter of ['a', 'b', 'c']) prefetchTranscript(client, scope, { kind: 'room', conversationId: letter.repeat(32) })
  prefetchTranscript(client, scope, { kind: 'room', conversationId: 'optimistic_1' })
  expect(calls.map(call => (call.args as { conversationId: string }).conversationId[0])).toEqual(['a', 'b'])
  calls[0]!.resolve(null)
  await flush()
  expect(calls.map(call => (call.args as { conversationId: string }).conversationId[0])).toEqual(['a', 'b', 'c'])
  calls[1]!.resolve(null)
  calls[2]!.resolve(null)
  await flush()
})

test('hover intent waits before reading and a quick pass-over reads nothing', async () => {
  vi.useFakeTimers()
  transcriptCache.setIdentity(scope)
  const { client, calls } = deferredClient()
  let intent!: ReturnType<typeof import('./transcript-cache-client').useTranscriptPrefetchIntent>
  const { useTranscriptPrefetchIntent } = await import('./transcript-cache-client')
  function Row() {
    const current = useTranscriptPrefetchIntent()
    React.useEffect(() => { intent = current }, [current])
    return null
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let renderer!: ReturnType<typeof create>
  await act(() => {
    renderer = create(<TranscriptCacheScopeProvider client={client} userId="user" workspaceId="workspace"><Row /></TranscriptCacheScopeProvider>)
  })
  intent.intend({ kind: 'personal', conversationId })
  vi.advanceTimersByTime(60)
  intent.cancel()
  vi.advanceTimersByTime(200)
  expect(calls).toHaveLength(0)
  intent.intend({ kind: 'personal', conversationId })
  vi.advanceTimersByTime(130)
  expect(calls.map(call => call.name)).toEqual(['chat/personal:getSummary'])
  await act(() => renderer.unmount())
})
