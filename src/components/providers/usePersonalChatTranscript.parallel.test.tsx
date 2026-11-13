import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  paginate: vi.fn(),
  conversationId: 'a'.repeat(32),
  workspaceId: 'workspace',
  parallelReads: true,
  activeStreams: undefined as unknown,
  execution: undefined as unknown,
  queryCalls: [] as { name: string; args: unknown }[],
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
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(query)
    mocks.queryCalls.push({ name, args })
    if (name === 'chat/personal:getSummary') return mocks.summary
    if (name === 'platform/uiSettings:mine') return mocks.parallelReads ? { personalChatParallelReadsRevision: 'parallel-reads-v1' } : {}
    if (name === 'chat/personal:activePublicStreams') return mocks.activeStreams
    if (name === 'chat/personal:getExecution') return mocks.execution
    return undefined
  },
  usePaginatedQuery: mocks.paginate,
}))

import { usePersonalChatTranscript } from './usePersonalChatTranscript'
import { useNativePersonalExecution } from './native-personal-execution'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
afterEach(() => {
  vi.unstubAllGlobals()
  mocks.activeStreams = undefined
  mocks.execution = undefined
  mocks.queryCalls.length = 0
})

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

test('rapid route and workspace switches fence retained rows, stream/execution scopes, and pagination', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const conversationA = 'a'.repeat(32)
  const conversationB = 'b'.repeat(32)
  const conversationC = 'c'.repeat(32)
  const workspaceA = 'workspace-a'
  const workspaceB = 'workspace-b'
  const messageA = { _id: 'message-a', conversationId: conversationA, status: 'generating', content: 'A' }
  const messageB = { _id: 'message-b', conversationId: conversationB, status: 'generating', content: 'B' }
  const messageC = { _id: 'message-c', conversationId: conversationC, status: 'generating', content: 'C' }
  const row = (message: typeof messageA) => ({ message, contextUser: null, outputs: [] })
  const loadMoreA = vi.fn()
  const loadMoreB = vi.fn()
  const loadMoreC = vi.fn()
  const executionA = {
    conversationId: conversationA, workspaceId: workspaceA, userId: 'viewer',
    compatibility: { readOnly: false }, run: null,
  }
  const executionB = {
    conversationId: conversationB, workspaceId: workspaceA, userId: 'viewer',
    compatibility: { readOnly: false }, run: null,
  }
  const executionC = {
    conversationId: conversationC, workspaceId: workspaceB, userId: 'viewer',
    compatibility: { readOnly: false }, run: null,
  }
  mocks.queryCalls.length = 0
  mocks.parallelReads = true
  mocks.workspaceId = workspaceA
  mocks.conversationId = conversationA
  mocks.summary = { _id: conversationA, workspaceId: workspaceA }
  mocks.execution = executionA
  mocks.paginate.mockReturnValue({ results: [row(messageA)], status: 'CanLoadMore', loadMore: loadMoreA })

  let observed!: ReturnType<typeof usePersonalChatTranscript>
  let executionQuery!: ReturnType<typeof useNativePersonalExecution>
  function Consumer() {
    const result = usePersonalChatTranscript({
      workspaceId: mocks.workspaceId, canQuery: true, canRead: true, pathname: '/app/chat',
      routeId: mocks.conversationId,
    })
    const execution = useNativePersonalExecution({
      enabled: true,
      canQuery: true,
      workspaceId: mocks.workspaceId,
      viewerUserId: 'viewer',
      conversationId: result.transcript.conversationId,
      summaryConversationId: result.selectedSummary?._id ?? null,
      transcriptConversationId: result.transcript.conversationId,
      transcriptStatus: result.transcript.status,
    })
    React.useEffect(() => {
      observed = result
      executionQuery = execution
    }, [execution, result])
    return null
  }
  const lastQueryArgs = (name: string) => {
    const calls = mocks.queryCalls.filter(call => call.name === name)
    return calls[calls.length - 1]?.args
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<Consumer />) })
    expect(observed.transcript.rows.map(({ message }) => message._id)).toEqual([messageA._id])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toEqual({
      workspaceId: workspaceA, conversationId: conversationA, messageIds: [messageA._id],
    })
    expect(lastQueryArgs('chat/personal:getExecution')).toEqual({ workspaceId: workspaceA, conversationId: conversationA })
    expect(executionQuery).toMatchObject({ status: 'ready', value: executionA })
    observed.transcript.loadMore()
    expect(loadMoreA).toHaveBeenCalledWith(50)

    mocks.conversationId = conversationB
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.conversationId).toBeNull()
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toBe('skip')
    expect(executionQuery.value).toBeNull()
    expect(mocks.paginate.mock.lastCall?.[1]).toEqual({
      workspaceId: workspaceA, conversationId: conversationB, unavailableAsEmpty: true,
    })
    observed.transcript.loadMore()
    expect(loadMoreA).toHaveBeenCalledTimes(1)

    mocks.summary = { _id: conversationB, workspaceId: workspaceA }
    mocks.paginate.mockReturnValue({ results: [row(messageA)], status: 'CanLoadMore', loadMore: loadMoreB })
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.conversationId).toBe(conversationB)
    expect(observed.transcript.rows).toEqual([])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toEqual({ workspaceId: workspaceA, conversationId: conversationB })
    expect(executionQuery.value).toBeNull()
    observed.transcript.loadMore()
    expect(loadMoreB).toHaveBeenCalledWith(50)

    mocks.paginate.mockReturnValue({ results: [row(messageB)], status: 'CanLoadMore', loadMore: loadMoreB })
    mocks.execution = executionB
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows.map(({ message }) => message._id)).toEqual([messageB._id])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toEqual({
      workspaceId: workspaceA, conversationId: conversationB, messageIds: [messageB._id],
    })
    expect(executionQuery).toMatchObject({ status: 'ready', value: executionB })

    mocks.conversationId = conversationA
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.conversationId).toBeNull()
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toBe('skip')
    expect(executionQuery.value).toBeNull()

    mocks.summary = { _id: conversationA, workspaceId: workspaceA }
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toEqual({ workspaceId: workspaceA, conversationId: conversationA })
    expect(executionQuery.value).toBeNull()
    mocks.paginate.mockReturnValue({ results: [row(messageA)], status: 'CanLoadMore', loadMore: loadMoreA })
    mocks.execution = executionA
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows.map(({ message }) => message._id)).toEqual([messageA._id])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toEqual({
      workspaceId: workspaceA, conversationId: conversationA, messageIds: [messageA._id],
    })
    expect(executionQuery).toMatchObject({ status: 'ready', value: executionA })

    mocks.workspaceId = workspaceB
    mocks.conversationId = conversationC
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.conversationId).toBeNull()
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toBe('skip')
    expect(executionQuery.value).toBeNull()

    mocks.summary = { _id: conversationC, workspaceId: workspaceB }
    mocks.paginate.mockReturnValue({ results: [row(messageA)], status: 'CanLoadMore', loadMore: loadMoreC })
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows).toEqual([])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(lastQueryArgs('chat/personal:getExecution')).toEqual({ workspaceId: workspaceB, conversationId: conversationC })
    expect(executionQuery.value).toBeNull()
    observed.transcript.loadMore()
    expect(loadMoreC).toHaveBeenCalledWith(50)

    mocks.paginate.mockReturnValue({ results: [row(messageC)], status: 'CanLoadMore', loadMore: loadMoreC })
    mocks.execution = executionC
    await act(() => renderer.update(<Consumer />))
    expect(observed.transcript.rows.map(({ message }) => message._id)).toEqual([messageC._id])
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toEqual({
      workspaceId: workspaceB, conversationId: conversationC, messageIds: [messageC._id],
    })
    expect(lastQueryArgs('chat/personal:getExecution')).toEqual({ workspaceId: workspaceB, conversationId: conversationC })
    expect(executionQuery).toMatchObject({ status: 'ready', value: executionC })
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})
