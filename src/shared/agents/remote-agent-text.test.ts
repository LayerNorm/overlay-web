import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRemoteText } from './remote-agent-text'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
const delta = (offset: number, text: string): AgentRemoteEvent => ({ protocolVersion: 1, eventId: 'e', environmentId: 'e', runId: 'r', occurredAt: 1, sourceSequence: 1, type: 'text_delta', payload: { offset, text } })
test('deltas append exactly once, including Unicode, and reject gaps or conflicting replays', () => {
  const first = applyRemoteText('', delta(0, 'Hello 🙂'))
  assert.equal(applyRemoteText(first, delta(0, 'Hello 🙂')), first)
  assert.equal(applyRemoteText(first, delta(first.length, ' world')), 'Hello 🙂 world')
  assert.throws(() => applyRemoteText(first, delta(first.length + 1, '!')), /OFFSET_MISMATCH/)
  assert.throws(() => applyRemoteText(first, delta(0, 'wrong')), /OFFSET_MISMATCH/)
})
test('legacy snapshots and bounded recovery anchors coexist without truncating earlier output', () => {
  const content = 'x'.repeat(600000)
  const anchor = { ...delta(0, ''), type: 'text_checkpoint', payload: { offset: 600000 - 65536, text: 'x'.repeat(65536) } } satisfies AgentRemoteEvent
  assert.equal(applyRemoteText(content, anchor), content)
  assert.equal(applyRemoteText(content, { ...anchor, payload: { text: 'old host checkpoint' } }), 'old host checkpoint')
})
