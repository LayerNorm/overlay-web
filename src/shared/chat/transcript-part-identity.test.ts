import assert from 'node:assert/strict'
import test from 'node:test'
import { withTranscriptPartIds } from './transcript-part-identity'
import { compactTranscriptSnapshot } from './compact-transcript-snapshot'

test('receipt identities survive checkpoint and finalization without replacing tool or generated UI IDs', () => {
  const persistence = { content: 'Progress', parts: [
    { type: 'text', text: 'Progress' },
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'lookup', toolOutput: { ok: true } } },
    { type: 'data', id: 'generated-ui', dataType: 'overlay.generated_ui', data: { body: 'Draft' } },
  ] }
  const first = withTranscriptPartIds('run', 'model:0', persistence)
  assert.deepEqual(withTranscriptPartIds('run', 'model:0', persistence), first)
  assert.deepEqual(withTranscriptPartIds('run', 'final', first), first)
  assert.notEqual(withTranscriptPartIds('run', 'model:1', persistence).parts[0].id, first.parts[0].id)
  assert.equal(first.parts[2].id, 'generated-ui')
  assert.deepEqual(first.parts[1].toolInvocation, persistence.parts[1].toolInvocation)
  assert.equal(persistence.parts[0].id, undefined)
})

test('public snapshots are UTF-8 bounded and preserve retained text identities', () => {
  const snapshot = compactTranscriptSnapshot(withTranscriptPartIds('run', 'model:0', {
    content: '界'.repeat(160_000), parts: [{ type: 'text', text: '界'.repeat(160_000) }],
  }))
  assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= 240 * 1024)
  assert.equal(snapshot.parts.find(part => part.id)?.id, JSON.stringify(['run', 'model:0', 0]))
})
