import assert from 'node:assert/strict'
import test from 'node:test'
import type { HybridSearchChunk, HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import { KnowledgeSearchService } from '@/server/knowledge/KnowledgeSearchService'
import type { KnowledgeSearchRepository } from '@/server/knowledge/KnowledgeSearchRepository'
import { KnowledgeBaseRetrievalService } from './KnowledgeBaseRetrievalService'
import { KnowledgeBaseServiceError, type KnowledgeBaseService } from './KnowledgeBaseService'

const FIXTURE_BILLING = {
  idempotencyKey: 'fixture-idempotency-key',
  operationId: 'knowledge-base.search',
  requestFingerprint: 'fixture-request-fingerprint',
} as const


type FakeBase = {
  id: string
  title: string
  sources: Array<{ id: string; title: string; enabled?: boolean; status?: string }>
}

function chunk(overrides: Partial<HybridSearchChunk> & { knowledgeSourceId: string }): HybridSearchChunk {
  return {
    chunkIndex: 0,
    score: 1,
    sourceId: overrides.knowledgeSourceId,
    sourceKind: 'file',
    text: `passage for ${overrides.knowledgeSourceId}`,
    ...overrides,
  }
}

/** Builds a KnowledgeBaseService stand-in that authorizes only the listed bases. */
function fakeBases(bases: FakeBase[]): KnowledgeBaseService {
  const byId = new Map(bases.map((base) => [base.id, base]))
  return {
    async getKnowledgeBase({ knowledgeBaseId }: { knowledgeBaseId: string }) {
      const base = byId.get(knowledgeBaseId)
      if (!base) throw new KnowledgeBaseServiceError('Knowledge base not found', 404)
      return { id: base.id, title: base.title }
    },
    async listSources({ knowledgeBaseId }: { knowledgeBaseId: string }) {
      const base = byId.get(knowledgeBaseId)
      if (!base) throw new KnowledgeBaseServiceError('Knowledge base not found', 404)
      return base.sources.map((source) => ({
        membership: { enabled: source.enabled ?? true },
        source: { id: source.id, status: source.status ?? 'ready', title: source.title },
      }))
    },
  } as unknown as KnowledgeBaseService
}

function fakeSearch(
  handler: (args: { canonicalSourceIds?: string[] }) => HybridSearchChunk[],
  spy?: { canonicalSourceIds?: string[]; calls: number },
): KnowledgeSearchService {
  const repository: KnowledgeSearchRepository = {
    async hybridSearch(args): Promise<HybridSearchResult> {
      if (spy) {
        spy.canonicalSourceIds = args.canonicalSourceIds
        spy.calls += 1
      }
      return { chunks: handler(args) }
    },
  }
  return new KnowledgeSearchService(repository)
}

test('scope is limited to enabled ready sources of authorized bases', async () => {
  const spy = { calls: 0 } as { canonicalSourceIds?: string[]; calls: number }
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{
      id: 'kb-1',
      title: 'Handbook',
      sources: [
        { id: 'source-ready', title: 'Ready source' },
        { id: 'source-disabled', title: 'Disabled', enabled: false },
        { id: 'source-indexing', title: 'Indexing', status: 'indexing' },
      ],
    }]),
    search: fakeSearch(() => [chunk({
      knowledgeSourceId: 'source-ready',
      knowledgeSourceVersionId: 'version-ready',
      title: 'Ready source',
    })], spy),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-1'],
    query: 'grounded',
    userId: 'user-1',
  })

  assert.deepEqual(spy.canonicalSourceIds, ['source-ready'])
  assert.deepEqual(result.citations.map(({ passages: _passages, ...rest }) => rest), [{
    knowledgeBaseId: 'kb-1',
    knowledgeBaseTitle: 'Handbook',
    sourceId: 'source-ready',
    sourceVersionId: 'version-ready',
    title: 'Ready source',
  }])
  assert.deepEqual(result.skippedKnowledgeBaseIds, [])
})

test('never falls back to unscoped user knowledge when no source qualifies', async () => {
  const spy = { calls: 0 } as { canonicalSourceIds?: string[]; calls: number }
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{ id: 'kb-empty', title: 'Empty', sources: [] }]),
    search: fakeSearch(() => [chunk({ knowledgeSourceId: 'leaked' })], spy),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-empty'],
    query: 'anything',
    userId: 'user-1',
  })

  assert.deepEqual(result.chunks, [])
  assert.deepEqual(result.citations, [])
  assert.equal(spy.calls, 0, 'must not issue an unscoped search')
})

test('searches across several bases and attributes each citation to its base', async () => {
  const spy = { calls: 0 } as { canonicalSourceIds?: string[]; calls: number }
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([
      { id: 'kb-a', title: 'Policies', sources: [{ id: 'a1', title: 'Leave policy' }] },
      { id: 'kb-b', title: 'Research', sources: [{ id: 'b1', title: 'Market study' }] },
    ]),
    search: fakeSearch(() => [
      chunk({ knowledgeSourceId: 'a1', score: 0.9, title: 'Leave policy' }),
      chunk({ knowledgeSourceId: 'b1', score: 0.8, title: 'Market study' }),
    ], spy),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-a', 'kb-b'],
    query: 'policy',
    userId: 'user-1',
  })

  assert.deepEqual(spy.canonicalSourceIds?.sort(), ['a1', 'b1'])
  assert.deepEqual(
    result.citations.map(({ knowledgeBaseId, sourceId }) => `${knowledgeBaseId}/${sourceId}`).sort(),
    ['kb-a/a1', 'kb-b/b1'],
  )
})

test('inaccessible bases are skipped without failing the turn or leaking existence', async () => {
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{ id: 'kb-ok', title: 'Visible', sources: [{ id: 'ok1', title: 'Doc' }] }]),
    search: fakeSearch(() => [chunk({ knowledgeSourceId: 'ok1' })]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-ok', 'kb-forbidden', 'kb-missing'],
    query: 'anything',
    userId: 'user-1',
  })

  assert.deepEqual(result.skippedKnowledgeBaseIds, ['kb-forbidden', 'kb-missing'])
  assert.deepEqual(result.citations.map(({ knowledgeBaseId }) => knowledgeBaseId), ['kb-ok'])
})

test('a large base cannot crowd out a small one', async () => {
  const large: FakeBase = {
    id: 'kb-large',
    title: 'Large',
    sources: Array.from({ length: 10 }, (_value, index) => ({
      id: `L${index}`,
      title: `Large doc ${index}`,
    })),
  }
  const small: FakeBase = {
    id: 'kb-small',
    title: 'Small',
    sources: [{ id: 'S0', title: 'Small doc' }],
  }
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([large, small]),
    // Every large-base chunk outranks the small base's only chunk.
    search: fakeSearch(() => [
      ...large.sources.map((source, index) => chunk({
        knowledgeSourceId: source.id,
        score: 1 - index * 0.01,
      })),
      chunk({ knowledgeSourceId: 'S0', score: 0.1 }),
    ]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-large', 'kb-small'],
    limit: 4,
    query: 'anything',
    userId: 'user-1',
  })

  assert.equal(result.chunks.length, 4)
  assert.ok(
    result.citations.some(({ knowledgeBaseId }) => knowledgeBaseId === 'kb-small'),
    'small base must still be represented',
  )
})

test('identical passages living in two bases are returned once', async () => {
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([
      { id: 'kb-a', title: 'A', sources: [{ id: 'a1', title: 'Shared doc' }] },
      { id: 'kb-b', title: 'B', sources: [{ id: 'b1', title: 'Shared doc copy' }] },
    ]),
    search: fakeSearch(() => [
      chunk({ knowledgeSourceId: 'a1', score: 0.9, text: 'The   Refund Window is 30 days.' }),
      chunk({ knowledgeSourceId: 'b1', score: 0.8, text: 'the refund window is 30 days.' }),
    ]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-a', 'kb-b'],
    query: 'refund',
    userId: 'user-1',
  })

  assert.equal(result.chunks.length, 1, 'normalized duplicate text must collapse')
  assert.deepEqual(result.citations.map(({ knowledgeBaseId }) => knowledgeBaseId), ['kb-a'])
})

test('a source shared by two bases is attributed to the first requested base', async () => {
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([
      { id: 'kb-second', title: 'Second', sources: [{ id: 'shared', title: 'Shared' }] },
      { id: 'kb-first', title: 'First', sources: [{ id: 'shared', title: 'Shared' }] },
    ]),
    search: fakeSearch(() => [chunk({ knowledgeSourceId: 'shared' })]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-first', 'kb-second'],
    query: 'shared',
    userId: 'user-1',
  })

  assert.deepEqual(result.citations.map(({ knowledgeBaseId }) => knowledgeBaseId), ['kb-first'])
})

test('citations carry highlighted passages with source offsets', async () => {
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{
      id: 'kb-1',
      title: 'Policies',
      sources: [{ id: 's1', title: 'Refund policy' }],
    }]),
    search: fakeSearch(() => [chunk({
      chunkIndex: 2,
      knowledgeSourceId: 's1',
      startOffset: 3600,
      text: 'The refund window is 30 days from delivery.',
      title: 'Refund policy',
    })]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-1'],
    query: 'refund window',
    userId: 'user-1',
  })

  const [citation] = result.citations
  assert.equal(citation?.passages.length, 1)
  const passage = citation!.passages[0]!
  assert.equal(passage.chunkIndex, 2)
  assert.equal(passage.startOffset, 3600)
  assert.deepEqual(
    passage.highlights.map(({ start, end }) => passage.text.slice(start, end)),
    ['refund', 'window'],
  )
})

test('several passages from one source collapse into one citation', async () => {
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{
      id: 'kb-1',
      title: 'Policies',
      sources: [{ id: 's1', title: 'Handbook' }],
    }]),
    search: fakeSearch(() => [
      chunk({ chunkIndex: 0, knowledgeSourceId: 's1', score: 0.9, text: 'Refund rules part one.' }),
      chunk({ chunkIndex: 1, knowledgeSourceId: 's1', score: 0.8, text: 'Refund rules part two.' }),
    ]),
  })

  const result = await service.search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-1'],
    query: 'refund',
    userId: 'user-1',
  })

  assert.equal(result.citations.length, 1)
  assert.deepEqual(result.citations[0]!.passages.map(({ chunkIndex }) => chunkIndex), [0, 1])
})

test('a corpus-wide question spreads across sources instead of one document', async () => {
  // One source dominates on score. A factual question should follow that ranking;
  // a question about the corpus itself should still reach every document.
  const sources = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, title: `Doc ${id}` }))
  const candidates = [
    // Six high-scoring passages from one document...
    ...Array.from({ length: 6 }, (_value, index) => chunk({
      chunkIndex: index,
      knowledgeSourceId: 'a',
      score: 1 - index * 0.001,
      text: `Doc a passage ${index}`,
    })),
    // ...and one weaker passage from each of the others.
    ...sources.slice(1).map((source, index) => chunk({
      knowledgeSourceId: source.id,
      score: 0.5 - index * 0.01,
      text: `Doc ${source.id} passage`,
    })),
  ]
  const build = () => new KnowledgeBaseRetrievalService({
    bases: fakeBases([{ id: 'kb-1', title: 'Notes', sources }]),
    search: fakeSearch(() => candidates),
  })

  const narrow = await build().search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-1'],
    limit: 5,
    query: 'which deficiency causes rickets',
    userId: 'user-1',
  })
  const narrowSources = new Set(narrow.citations.map(({ sourceId }) => sourceId))
  assert.ok(
    narrowSources.size < sources.length,
    'a narrow question should follow score ranking, concentrating on the best source',
  )

  const broad = await build().search({
    billing: FIXTURE_BILLING,
    knowledgeBaseIds: ['kb-1'],
    limit: 5,
    query: 'take me through what is in Notes',
    userId: 'user-1',
  })
  assert.deepEqual(
    [...new Set(broad.citations.map(({ sourceId }) => sourceId))].sort(),
    ['a', 'b', 'c', 'd', 'e'],
    'a corpus-wide question must reach every source',
  )
})

test('breadthFirst can be forced independently of the query wording', async () => {
  const sources = ['a', 'b'].map((id) => ({ id, title: `Doc ${id}` }))
  const candidates = [
    ...Array.from({ length: 4 }, (_value, index) => chunk({
      chunkIndex: index,
      knowledgeSourceId: 'a',
      score: 1 - index * 0.001,
      text: `Doc a passage ${index}`,
    })),
    chunk({ knowledgeSourceId: 'b', score: 0.2, text: 'Doc b passage' }),
  ]
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases([{ id: 'kb-1', title: 'Notes', sources }]),
    search: fakeSearch(() => candidates),
  })
  const result = await service.search({
    billing: FIXTURE_BILLING,
    breadthFirst: true,
    knowledgeBaseIds: ['kb-1'],
    limit: 2,
    query: 'a plainly factual question',
    userId: 'user-1',
  })
  assert.deepEqual(
    [...new Set(result.citations.map(({ sourceId }) => sourceId))].sort(),
    ['a', 'b'],
  )
})

test('requested bases are deduped and capped', async () => {
  const spy = { calls: 0 } as { canonicalSourceIds?: string[]; calls: number }
  const bases = Array.from({ length: 12 }, (_value, index) => ({
    id: `kb-${index}`,
    title: `Base ${index}`,
    sources: [{ id: `s${index}`, title: `Doc ${index}` }],
  }))
  const service = new KnowledgeBaseRetrievalService({
    bases: fakeBases(bases),
    search: fakeSearch(() => [], spy),
  })

  await service.search({
    billing: {
      idempotencyKey: 'fixture-idempotency-key',
      operationId: 'knowledge-base.search',
      requestFingerprint: 'fixture-request-fingerprint',
    },
    knowledgeBaseIds: ['kb-0', 'kb-0', ...bases.map(({ id }) => id)],
    query: 'anything',
    userId: 'user-1',
  })

  assert.ok((spy.canonicalSourceIds?.length ?? 0) <= 8, 'must respect the per-turn base cap')
})
