import assert from 'node:assert/strict'
import test from 'node:test'
import {
  externalSourcesFromMarkdown,
  knowledgeChipLabel,
  knowledgeCitationsFromMarkdown,
  knowledgeSourceHref,
  knowledgeSourcesFromCitations,
  linkifyInlineKnowledgeCitations,
} from '../../../packages/overlay-chat-react/src/lib/knowledge-sources'

test('memories link into Settings → Memories, not knowledge bases', () => {
  assert.equal(
    knowledgeSourceHref({ kind: 'memory', sourceId: 'mem_1' }),
    '/app/settings?section=memories&memory=mem_1',
  )
  assert.equal(
    knowledgeSourceHref({ kind: 'file', sourceId: 'file_1' }),
    '/app/files?file=file_1',
  )
})

test('citations become ordered internal sources for the sources panel', () => {
  const sources = knowledgeSourcesFromCitations({
    '2': { kind: 'file', sourceId: 'file_1', title: 'Roadmap.md' },
    '1': { kind: 'memory', sourceId: 'mem_1', title: 'User loves Celsius', snippet: 'User loves Celsius' },
  })

  assert.deepEqual(sources, [
    {
      url: '/app/settings?section=memories&memory=mem_1',
      internalHref: '/app/settings?section=memories&memory=mem_1',
      internalKind: 'memory',
      title: 'User loves Celsius',
      snippet: 'User loves Celsius',
      origin: 'knowledge',
    },
    {
      url: '/app/files?file=file_1',
      internalHref: '/app/files?file=file_1',
      internalKind: 'file',
      title: 'Roadmap.md',
      origin: 'knowledge',
    },
  ])
})

test('persisted transcripts recover their citations from the Sources line', () => {
  const citations = knowledgeCitationsFromMarkdown(
    'Answer text.\n\n**Sources:** [1](/app/settings?section=memories&memory=mem_1) [2](/app/files?file=file_1)',
  )
  assert.deepEqual(citations, {
    '1': { kind: 'memory', sourceId: 'mem_1' },
    '2': { kind: 'file', sourceId: 'file_1' },
  })
})

test('legacy /app/knowledge memory links still resolve to a memory', () => {
  assert.deepEqual(
    knowledgeCitationsFromMarkdown('Answer.\n\n**Sources:** [1](/app/knowledge?memory=mem_9)'),
    { '1': { kind: 'memory', sourceId: 'mem_9' } },
  )
})

test('a reply without a Sources line recovers nothing', () => {
  assert.deepEqual(knowledgeCitationsFromMarkdown('Just an answer.'), {})
})

test('memory chips shorten to the first two words', () => {
  assert.equal(
    knowledgeChipLabel({
      kind: 'memory',
      sourceId: 'mem_1',
      title: 'User loves Celsius energy powder packets.',
    }),
    'Memory: User loves…',
  )
  // Nothing was cut, so nothing is elided.
  assert.equal(
    knowledgeChipLabel({ kind: 'memory', sourceId: 'mem_2', title: 'Prefers dark' }),
    'Memory: Prefers dark',
  )
  assert.equal(knowledgeChipLabel({ kind: 'memory', sourceId: 'mem_3' }), 'Memory')
  assert.equal(
    knowledgeChipLabel({ kind: 'file', sourceId: 'file_1', title: 'Roadmap.md' }),
    'Roadmap.md',
  )
})

test('inline markers become knowledge chips, code fences are left alone', () => {
  const linkified = linkifyInlineKnowledgeCitations(
    'Per your note [1] this holds.\n\n```\nconst a = list[1]\n```',
    { '1': { kind: 'memory', sourceId: 'mem_1', title: 'User loves Celsius energy packets' } },
  )
  assert.equal(
    linkified,
    'Per your note [Memory: User loves…](#overlay-knowcite-1) this holds.\n\n```\nconst a = list[1]\n```',
  )
})

test('external links in a stripped Sources block survive as sources', () => {
  assert.deepEqual(
    externalSourcesFromMarkdown(
      'Answer.\n\n**Sources:** [Celsius](https://celsius.com/faq) https://example.com/a',
    ),
    [
      { url: 'https://celsius.com/faq', title: 'Celsius', origin: 'web-search' },
      { url: 'https://example.com/a', title: '', origin: 'web-search' },
    ],
  )
  assert.deepEqual(externalSourcesFromMarkdown('Answer with https://example.com inline.'), [])
})
