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

test('knowledge-base retrieval emits notebook-scoped citations', () => {
  const bundle = formatAutoRetrievalBundle([
    {
      chunkIndex: 0,
      knowledgeSourceId: 'source_1',
      knowledgeSourceVersionId: 'version_1',
      score: 1,
      sourceId: 'source_1',
      sourceKind: 'file',
      text: 'Electrophilic substitution requires a catalyst.',
      title: 'Organic Chemistry',
    },
  ], false, {
    citations: [{
      knowledgeBaseId: 'kb_1',
      knowledgeBaseTitle: 'Organic Chemistry Handbook',
      sourceId: 'source_1',
      sourceVersionId: 'version_1',
      title: 'Organic Chemistry',
    }],
  })

  assert.match(bundle.extension, /from the knowledge base "Organic Chemistry Handbook"/)
  assert.deepEqual(bundle.citations, {
    '1': { kind: 'knowledge', knowledgeBaseId: 'kb_1', sourceId: 'source_1' },
  })
})

test('multi-base retrieval labels each passage with its knowledge base', () => {
  const bundle = formatAutoRetrievalBundle([
    {
      chunkIndex: 0,
      knowledgeSourceId: 'source_1',
      score: 1,
      sourceId: 'source_1',
      sourceKind: 'file',
      text: 'Refunds are processed within 30 days.',
      title: 'Refund policy',
    },
    {
      chunkIndex: 0,
      knowledgeSourceId: 'source_2',
      score: 0.9,
      sourceId: 'source_2',
      sourceKind: 'file',
      text: 'Q3 revenue grew 12%.',
      title: 'Q3 report',
    },
  ], false, {
    citations: [
      {
        knowledgeBaseId: 'kb_policies',
        knowledgeBaseTitle: 'Policies',
        sourceId: 'source_1',
        title: 'Refund policy',
      },
      {
        knowledgeBaseId: 'kb_research',
        knowledgeBaseTitle: 'Research',
        sourceId: 'source_2',
        title: 'Q3 report',
      },
    ],
  })

  assert.match(bundle.extension, /from the selected knowledge bases: "Policies", "Research"/)
  assert.match(bundle.extension, /Policies › Refund policy/)
  assert.match(bundle.extension, /Research › Q3 report/)
  assert.deepEqual(bundle.citations, {
    '1': { kind: 'knowledge', knowledgeBaseId: 'kb_policies', sourceId: 'source_1' },
    '2': { kind: 'knowledge', knowledgeBaseId: 'kb_research', sourceId: 'source_2' },
  })
})
