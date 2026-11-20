import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { projectActivePublicStreams } from '@/shared/chat/public-stream-projection'

type Cursor = { segmentIndex: number; sequence?: number }
const mocks = vi.hoisted(() => ({
  respond: (() => undefined) as (args: { cursors: Cursor[] }) => unknown,
  whole: undefined as unknown,
  calls: [] as { name: string; args: unknown }[],
}))
vi.mock('./usePublicStreamMetrics', () => ({ usePublicStreamMetrics: () => {} }))
vi.mock('convex/react', () => ({
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(query)
    mocks.calls.push({ name, args })
    if (args === 'skip') return undefined
    if (name === 'chat/personal:activePublicStreamUpdates') return mocks.respond(args as { cursors: Cursor[] })
    if (name === 'chat/personal:activePublicStreams') return mocks.whole
    return undefined
  },
}))

import { api } from '../../../convex/_generated/api'
import { useLivePublicStreams } from './useLivePublicStreams'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}
afterEach(() => {
  vi.unstubAllGlobals()
  mocks.respond = () => undefined
  mocks.whole = undefined
  mocks.calls.length = 0
})

const identity = { assistantMessageId: 'reply', runId: 'run', executionGeneration: 0, receiptId: 'model:0', invocation: 0 }
const read = (sequence: number, fromSegmentIndex: number, texts: string[]) => [{
  ...identity, sequence, fromSegmentIndex, segments: texts.map((text, offset) => ({ index: fromSegmentIndex + offset, text })),
}]
type Row = { _id: string; content: string; status: string; parts: unknown[]; publicStreamCheckpoint?: typeof checkpoint }
const checkpoint = { runId: 'run', executionGeneration: 0, receiptId: 'model:0', invocation: 0 }

test('live text grows from incremental reads and hands off to the settled reply without a flash or duplicate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const shown: string[] = []
  function Reply({ row, incremental = true }: { row: Row; incremental?: boolean }) {
    const streams = useLivePublicStreams({
      scope: { workspaceId: 'ws', conversationId: 'chat' },
      messageIds: row.status === 'generating' ? [row._id] : [],
      incremental,
      fullQuery: api.chat.personal.activePublicStreams,
      updatesQuery: api.chat.personal.activePublicStreamUpdates,
    })
    shown.push(projectActivePublicStreams([row], streams)[0]!.content)
    return null
  }
  const live: Row = { _id: 'reply', content: '', status: 'generating', parts: [] }
  let renderer!: ReturnType<typeof create>
  mocks.respond = ({ cursors }) => cursors.length === 0 ? read(0, 0, ['Hel']) : undefined
  await act(() => { renderer = create(<Reply row={live} />) })
  expect(shown.at(-1)).toBe('Hel')
  const sent = mocks.calls.filter(call => call.name === 'chat/personal:activePublicStreamUpdates' && call.args !== 'skip')
  expect((sent.at(-1)!.args as { cursors: Cursor[] }).cursors).toMatchObject([{ segmentIndex: 0 }])
  // No sequence: the arguments stay the same while the segment grows, so it is one subscription.
  expect((sent.at(-1)!.args as { cursors: Cursor[] }).cursors[0]).not.toHaveProperty('sequence')

  // The next read is loading: what is on screen stays.
  await act(() => renderer.update(<Reply row={live} />))
  expect(shown.at(-1)).toBe('Hel')

  mocks.respond = ({ cursors }) => cursors[0]?.segmentIndex === 0 ? read(1, 0, ['Hello there.']) : undefined
  await act(() => renderer.update(<Reply row={live} />))
  expect(shown.at(-1)).toBe('Hello there.')

  // The step settles: the row carries the text and its checkpoint before the stream read catches up.
  const settled: Row = { ...live, content: 'Hello there.', status: 'completed', publicStreamCheckpoint: checkpoint }
  await act(() => renderer.update(<Reply row={settled} />))
  expect(shown.at(-1)).toBe('Hello there.')
  const afterFirstText = shown.slice(shown.indexOf('Hel'))
  expect(afterFirstText.every(text => text.startsWith('Hel') && !text.includes('Hello there.\n\nHello'))).toBe(true)
  expect(mocks.calls.at(-1)?.args).toBe('skip')
  renderer.unmount()
})

test('a backend without the incremental query is read whole', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.whole = [{ ...identity, sequence: 2, text: 'Whole text' }]
  const seen: unknown[] = []
  function Reader() {
    seen.push(useLivePublicStreams({
      scope: { workspaceId: 'ws', conversationId: 'chat' }, messageIds: ['reply'], incremental: false,
      fullQuery: api.chat.personal.activePublicStreams, updatesQuery: api.chat.personal.activePublicStreamUpdates,
    }))
    return null
  }
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<Reader />) })
  expect(seen.at(-1)).toEqual(mocks.whole)
  expect(mocks.calls.filter(call => call.name === 'chat/personal:activePublicStreamUpdates').every(call => call.args === 'skip')).toBe(true)
  renderer.unmount()
})
