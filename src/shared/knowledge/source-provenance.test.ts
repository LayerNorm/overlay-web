import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateSourceFreshness,
  inferOriginFromKind,
  readSourceProvenance,
  withSourceProvenance,
} from './source-provenance'

const identity = { provider: 'ai-gateway', modelId: 'openai/text-embedding-3-small', modelVersion: 'v1' }

test('provenance round-trips through metadata without losing other keys', () => {
  const metadata = withSourceProvenance({ content: 'body', pageCount: 3 }, {
    origin: 'url',
    ref: 'https://example.com/policy',
    label: 'example.com',
    ingestedAt: 1700,
  })
  assert.equal(metadata.content, 'body')
  assert.equal(metadata.pageCount, 3)
  assert.deepEqual(readSourceProvenance(metadata), {
    origin: 'url',
    ref: 'https://example.com/policy',
    label: 'example.com',
    ingestedAt: 1700,
    addedBy: undefined,
    originUpdatedAt: undefined,
    promotedFromArtifactId: undefined,
    promotedFromProjectId: undefined,
  })
})

test('unknown or missing provenance reads as undefined', () => {
  assert.equal(readSourceProvenance(undefined), undefined)
  assert.equal(readSourceProvenance({}), undefined)
  assert.equal(readSourceProvenance({ provenance: 'nope' }), undefined)
  assert.equal(readSourceProvenance({ provenance: { origin: 'martian' } }), undefined)
})

test('legacy sources infer an origin from their kind', () => {
  assert.equal(inferOriginFromKind('file'), 'upload')
  assert.equal(inferOriginFromKind('note'), 'note')
  assert.equal(inferOriginFromKind('url'), 'url')
  assert.equal(inferOriginFromKind('something-else'), 'text')
})

test('a source indexed at its current hash is fresh', () => {
  const freshness = evaluateSourceFreshness({
    status: 'ready',
    contentHash: 'hash-a',
    indexedContentHash: 'hash-a',
    lastIndexedAt: 1000,
    chunkCount: 4,
    currentEmbeddingIdentity: identity,
    indexedEmbeddingIdentities: [identity],
  })
  assert.equal(freshness.state, 'fresh')
  assert.equal(freshness.contentChangedSinceIndex, false)
  assert.equal(freshness.embeddingIdentityDrifted, false)
})

test('content changing after indexing marks the source stale', () => {
  const freshness = evaluateSourceFreshness({
    status: 'ready',
    contentHash: 'hash-b',
    indexedContentHash: 'hash-a',
    lastIndexedAt: 1000,
    chunkCount: 4,
    currentEmbeddingIdentity: identity,
    indexedEmbeddingIdentities: [identity],
  })
  assert.equal(freshness.state, 'stale')
  assert.equal(freshness.contentChangedSinceIndex, true)
  assert.match(freshness.reason ?? '', /Content changed/)
})

test('embedding model drift marks the source stale even when content matches', () => {
  const freshness = evaluateSourceFreshness({
    status: 'ready',
    contentHash: 'hash-a',
    indexedContentHash: 'hash-a',
    lastIndexedAt: 1000,
    chunkCount: 4,
    currentEmbeddingIdentity: { ...identity, modelVersion: 'v2' },
    indexedEmbeddingIdentities: [identity],
  })
  assert.equal(freshness.state, 'stale')
  assert.equal(freshness.embeddingIdentityDrifted, true)
  assert.match(freshness.reason ?? '', /different embedding model/)
})

test('a ready source with no indexed passages reports never-indexed', () => {
  const freshness = evaluateSourceFreshness({
    status: 'ready',
    contentHash: 'hash-a',
    indexedContentHash: 'hash-a',
    lastIndexedAt: 1000,
    chunkCount: 0,
    currentEmbeddingIdentity: identity,
  })
  assert.equal(freshness.state, 'never-indexed')
  assert.match(freshness.reason ?? '', /no indexed passages/)
})

test('failed indexing surfaces its status message', () => {
  const freshness = evaluateSourceFreshness({
    status: 'failed',
    statusMessage: 'Extraction produced no text',
    contentHash: 'hash-a',
    lastIndexedAt: undefined,
    chunkCount: 0,
  })
  assert.equal(freshness.state, 'failed')
  assert.equal(freshness.reason, 'Extraction produced no text')
})

test('drift is not claimed when the indexed identity is unknown', () => {
  const freshness = evaluateSourceFreshness({
    status: 'ready',
    contentHash: 'hash-a',
    indexedContentHash: 'hash-a',
    lastIndexedAt: 1000,
    chunkCount: 2,
    currentEmbeddingIdentity: identity,
    indexedEmbeddingIdentities: [],
  })
  assert.equal(freshness.state, 'fresh')
  assert.equal(freshness.embeddingIdentityDrifted, false)
})
