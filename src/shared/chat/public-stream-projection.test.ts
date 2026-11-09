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

test('repeated text in a new invocation is not suppressed by content matching', () => {
  const message = { _id: 'assistant', content: 'Settled\n\nLive', parts: [] }
  const projected = projectActivePublicStreams([message], [{
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 1, receiptId: 'model:1', invocation: 1,
    sequence: 3, text: 'Live', truncatedMarker: '[Additional output omitted]',
  }])
  expect(projected[0]?.content).toBe('Settled\n\nLive\n\nLive\n\n[Additional output omitted]')
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
  expect(projectActivePublicStreams([canonical], [later])[0]?.content).toBe('Compacted settled answer\n\nnew')
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

test('roomMessageView-shaped rows keep normal and active messages and converge at a checkpoint', () => {
  const roomMessages = [
    { id: 'human', conversationId: 'room', content: 'Question', parts: [], status: 'completed' },
    { id: 'assistant', conversationId: 'room', content: 'Draft', parts: [], status: 'generating' },
  ]
  const active = {
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 2, receiptId: 'model:3',
    invocation: 3, sequence: 1, text: 'Live answer',
  }
  const projected = projectActivePublicStreams(roomMessages, [active])
  expect(projected.map(message => message.id)).toEqual(['human', 'assistant'])
  expect(projected[1]?.content).toBe('Draft\n\nLive answer')
  const canonical = {
    ...projected[1]!,
    content: 'Canonical answer',
    publicStreamCheckpoint: {
      runId: 'run', executionGeneration: 2, receiptId: 'model:3', invocation: 3,
    },
  }
  expect(projectActivePublicStreams([canonical], [active])[0]).toMatchObject({
    id: 'assistant', content: 'Canonical answer',
  })
})

test('a stream continuing a cut-off call extends the last text block and restores it afterwards', () => {
  const cut = '22. The Thames Barrier.\n23'
  const message = { _id: 'assistant', content: cut, parts: [{ type: 'text', id: 'settled', text: cut }] }
  const stream = {
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 0, receiptId: 'model:1', invocation: 1,
    sequence: 0, text: '. The Tagus', continuesPrevious: true,
  }
  const live = projectActivePublicStreams([message], [stream])
  expect(live[0]?.content).toBe('22. The Thames Barrier.\n23. The Tagus')
  expect(live[0]?.parts).toHaveLength(1)
  expect(live[0]?.parts?.[0]).toMatchObject({ id: 'settled', text: '22. The Thames Barrier.\n23. The Tagus' })

  const more = projectActivePublicStreams(live, [{ ...stream, sequence: 1, text: '. The Tagus barrier.\n24. Next' }])
  expect(more[0]?.content).toBe('22. The Thames Barrier.\n23. The Tagus barrier.\n24. Next')
  expect(more[0]?.parts).toHaveLength(1)

  const restored = projectActivePublicStreams(more, [])
  expect(restored[0]?.content).toBe(cut)
  expect(restored[0]?.parts).toEqual(message.parts)
})

test('a stream after a separate call keeps its own block and a blank line', () => {
  const message = { _id: 'assistant', content: 'Checked.', parts: [{ type: 'text', id: 'settled', text: 'Checked.' }] }
  const projected = projectActivePublicStreams([message], [{
    assistantMessageId: 'assistant', runId: 'run', executionGeneration: 0, receiptId: 'model:1', invocation: 1,
    sequence: 0, text: 'Done.',
  }])
  expect(projected[0]?.content).toBe('Checked.\n\nDone.')
  expect(projected[0]?.parts).toHaveLength(2)
})

test('live text goes ahead of the tools its call has started, after the settled steps', () => {
  const tool = (toolCallId: string, id?: string) => ({
    type: 'tool-invocation', ...(id ? { id } : {}),
    toolInvocation: { toolCallId, toolName: 'search_memory', state: id ? 'output-available' : 'input-available' },
  })
  const message = {
    _id: 'assistant', status: 'generating', content: 'First, search memory.',
    parts: [{ type: 'text', text: 'First, search memory.', id: 'settled-text' }, tool('a', 'settled-tool'), tool('b')],
  }
  const stream = { assistantMessageId: 'assistant', runId: 'run', executionGeneration: 0, receiptId: 'model:1', invocation: 1 }
  const live = projectActivePublicStreams([message], [{ ...stream, sequence: 0, text: 'Now listing your notes.' }])
  const order = (parts: readonly unknown[] = []) => parts.map(part => {
    const value = part as { type: string; text?: string; toolInvocation?: { toolCallId: string } }
    return value.type === 'text' ? value.text : value.toolInvocation?.toolCallId
  })
  expect(order(live[0]?.parts)).toEqual(['First, search memory.', 'a', 'Now listing your notes.', 'b'])
  // A later snapshot replaces the same live part in place.
  const more = projectActivePublicStreams(live, [{ ...stream, sequence: 1, text: 'Now listing your notes, all of them.' }])
  expect(order(more[0]?.parts)).toEqual(['First, search memory.', 'a', 'Now listing your notes, all of them.', 'b'])
  // Before any step settles, the first sentence still precedes its running tool.
  const first = projectActivePublicStreams([{ ...message, content: '', parts: [tool('a')] }], [{ ...stream, sequence: 0, text: 'First, search memory.' }])
  expect(order(first[0]?.parts)).toEqual(['First, search memory.', 'a'])
})
