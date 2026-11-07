import { expect, test } from 'vitest'
import { projectActivePublicStreams } from './public-stream-projection'

test('active snapshots replace their own stable provisional part and never mutate settled rows', () => {
  const messages = [{ _id: 'assistant', content: 'Settled', parts: [] }, { _id: 'other', content: 'Other' }]
  const base = { assistantMessageId: 'assistant', runId: 'run', executionGeneration: 3, receiptId: 'model:1', invocation: 1, sequence: 0 }
  const first = projectActivePublicStreams(messages, [{ ...base, text: 'Live' }])
  expect(first[0]?.content).toBe('Settled\n\nLive')
  const next = projectActivePublicStreams(first, [{ ...base, sequence: 1, text: 'Live more' }])
  expect(next[0]?.content).toBe('Settled\n\nLive more')
  expect(next[0]?.parts).toHaveLength(1)
  expect(next[1]).toBe(messages[1])
})

test('stale sequences cannot replace newer snapshots and generation changes replace provisional parts', () => {
  const base = { _id: 'assistant', content: 'Settled', parts: [] }
  const stream = { assistantMessageId: 'assistant', runId: 'run', executionGeneration: 3, receiptId: 'model:1', invocation: 1 }
  const newer = projectActivePublicStreams([base], [{ ...stream, sequence: 4, text: 'Latest' }])
  const stale = projectActivePublicStreams(newer, [{ ...stream, sequence: 2, text: 'Old' }])
  expect(stale[0]?.content).toBe('Settled\n\nLatest')

  const nextGeneration = projectActivePublicStreams(stale, [{
    ...stream, executionGeneration: 4, sequence: 0, text: 'New generation',
  }])
  expect(nextGeneration[0]?.content).toBe('Settled\n\nNew generation')
  expect(nextGeneration[0]?.parts).toHaveLength(1)
})

test('canonical text is not duplicated and a persisted truncation marker converges', () => {
  const message = { _id: 'assistant', content: 'Settled\n\nLive', parts: [] }
  const projected = projectActivePublicStreams([message], [{
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 1, receiptId: 'model:1', invocation: 1,
    sequence: 3, text: 'Live', truncatedMarker: '[Additional output omitted]',
  }])
  expect(projected[0]?.content).toBe('Settled\n\nLive\n\n[Additional output omitted]')
})

test('checkpoint identity removes only the settled invocation, including empty or rewritten canonical text', () => {
  const base = { _id: 'assistant', content: '', parts: [], status: 'generating' }
  const active = {
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 2, receiptId: 'model:3',
    invocation: 3, sequence: 1, text: 'Same answer',
  }
  const projected = projectActivePublicStreams([base], [active])
  const canonical = {
    ...projected[0]!,
    content: 'Compacted settled answer',
    publicStreamCheckpoint: {
      runId: 'run', executionGeneration: 2, receiptId: 'model:3', invocation: 3,
    },
  }
  expect(projectActivePublicStreams([canonical], [active])[0]?.content).toBe('Compacted settled answer')
  const later = { ...active, executionGeneration: 3, receiptId: 'model:0', invocation: 0, text: 'new' }
  expect(projectActivePublicStreams([canonical], [later])[0]?.content).toBe('Compacted settled answer')
})

test('older invocations cannot replace a newer active snapshot and empty canonical bases remove provisional output', () => {
  const base = { _id: 'assistant', content: '', parts: [], status: 'generating' }
  const newer = {
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 2, receiptId: 'model:4',
    invocation: 4, sequence: 1, text: 'new',
  }
  const projected = projectActivePublicStreams([base], [newer])
  const stale = { ...newer, receiptId: 'model:3', invocation: 3, text: 'old' }
  expect(projectActivePublicStreams(projected, [stale])[0]?.content).toBe('new')
  const empty = { ...projected[0]!, content: '', parts: [] }
  expect(projectActivePublicStreams([empty], [])[0]?.content).toBe('')
})
