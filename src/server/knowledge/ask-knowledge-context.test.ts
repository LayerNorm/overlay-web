import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAutoRetrievalBundle } from './ask-knowledge-context'

test('auto retrieval asks the model for UI-linkable source numbers', () => {
  const bundle = formatAutoRetrievalBundle([
    {
      chunkIndex: 0,
      score: 1,
      sourceId: 'memory_1',
      sourceKind: 'memory',
      text: 'The deployment checkpoint is cobalt-731.',
      title: 'Aurora Finch marker',
    },
  ])

  assert.match(bundle.extension, /append exactly one final \*\*Sources:\*\* line/)
  assert.match(bundle.extension, /\[1\] \(memory\) Aurora Finch marker/)
  assert.deepEqual(bundle.citations, {
    '1': { kind: 'memory', sourceId: 'memory_1' },
  })
})
