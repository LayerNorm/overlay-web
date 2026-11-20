import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  paginate: vi.fn(),
  activeStreams: undefined as unknown,
  queryCalls: [] as { name: string; args: unknown }[],
}))
vi.mock('./usePublicStreamMetrics', () => ({ usePublicStreamMetrics: () => {} }))
vi.mock('convex/react', () => ({
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(query)
    mocks.queryCalls.push({ name, args })
    if (name === 'chat/personal:getSummary') return mocks.summary
    if (name === 'platform/uiSettings:mine') return { personalChatParallelReadsRevision: 'parallel-reads-v1' }
    if (name === 'chat/personal:activePublicStreams') return mocks.activeStreams
    return undefined
  },
  usePaginatedQuery: mocks.paginate,
}))

import { usePersonalConversationTranscript } from './usePersonalConversationTranscript'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
afterEach(() => {
  vi.unstubAllGlobals()
  mocks.summary = undefined
  mocks.activeStreams = undefined
  mocks.queryCalls.length = 0
})

const conversationId = 'n'.repeat(32)
const lastQueryArgs = (name: string) => mocks.queryCalls.filter(call => call.name === name).at(-1)?.args

test('reads a conversation named by id, without a route, and projects its live reply text', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.summary = { _id: conversationId, workspaceId: 'workspace' }
  const reply = { _id: 'reply', conversationId, role: 'assistant', status: 'generating', content: '', parts: [] }
  mocks.paginate.mockReturnValue({ results: [{ message: reply, contextUser: null, outputs: [] }], status: 'Exhausted', loadMore: vi.fn() })
  mocks.activeStreams = [{
    assistantMessageId: 'reply', runId: 'run', executionGeneration: 1, receiptId: 'receipt',
    invocation: 1, sequence: 3, text: 'Live note answer',
  }]
  let observed!: ReturnType<typeof usePersonalConversationTranscript>
  function Consumer({ id }: { id: string | null }) {
    const result = usePersonalConversationTranscript({ workspaceId: 'workspace', conversationId: id, canQuery: true, canRead: true })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<Consumer id={conversationId} />) })
    expect(lastQueryArgs('chat/personal:getSummary')).toEqual({ workspaceId: 'workspace', conversationId })
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toEqual({ workspaceId: 'workspace', conversationId, messageIds: ['reply'] })
    expect(observed.transcript.status).toBe('ready')
    expect(observed.transcript.conversationId).toBe(conversationId)
    expect(observed.transcript.rows).toHaveLength(1)
    expect(observed.transcript.rows[0]!.message.content).toContain('Live note answer')

    await act(() => renderer.update(<Consumer id={null} />))
    expect(observed.transcript.rows).toEqual([])
    expect(observed.transcript.conversationId).toBeNull()
    expect(lastQueryArgs('chat/personal:getSummary')).toBe('skip')
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})

test('idle conversations never subscribe to live streams and malformed ids are not queried', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.summary = { _id: conversationId, workspaceId: 'workspace' }
  const reply = { _id: 'reply', conversationId, role: 'assistant', status: 'completed', content: 'Done', parts: [] }
  mocks.paginate.mockReturnValue({ results: [{ message: reply, contextUser: null, outputs: [] }], status: 'Exhausted', loadMore: vi.fn() })
  let observed!: ReturnType<typeof usePersonalConversationTranscript>
  function Consumer({ id }: { id: string }) {
    const result = usePersonalConversationTranscript({ workspaceId: 'workspace', conversationId: id, canQuery: true, canRead: true })
    React.useEffect(() => { observed = result }, [result])
    return null
  }
  let renderer!: ReturnType<typeof create>
  try {
    await act(() => { renderer = create(<Consumer id={conversationId} />) })
    expect(lastQueryArgs('chat/personal:activePublicStreams')).toBe('skip')
    expect(observed.transcript.rows[0]!.message.content).toBe('Done')

    await act(() => renderer.update(<Consumer id="not a convex id" />))
    expect(lastQueryArgs('chat/personal:getSummary')).toBe('skip')
    expect(observed.selectedSummary).toBeNull()
    expect(observed.transcript.status).toBe('unavailable')
    expect(observed.transcript.rows).toEqual([])
  } finally {
    if (renderer) await act(() => renderer.unmount())
  }
})
