import assert from 'node:assert/strict'
import test from 'node:test'
import { memoriesToClientListRows } from './memory-display-segments'

test('workspace memory rows expose creator attribution and creator-only deletion', () => {
  const memories = [
    {
      _id: 'memory_a',
      content: 'A workspace memory from Ada.',
      createdAt: 10,
      source: 'chat',
      userId: 'user_a',
    },
    {
      _id: 'memory_b',
      content: 'A workspace memory from Grace.',
      createdAt: 20,
      source: 'manual',
      userId: 'user_b',
    },
  ]
  const attributionsByUserId = new Map([
    ['user_a', { name: 'Ada Lovelace', principalId: 'principal_a' }],
    ['user_b', { name: 'Grace Hopper', principalId: 'principal_b' }],
  ])

  const rows = memoriesToClientListRows(memories, {
    attributionsByUserId,
    viewerUserId: 'user_a',
  })

  assert.deepEqual(rows.map((row) => ({
    canDelete: row.canDelete,
    creatorName: row.creatorName,
    creatorPrincipalId: row.creatorPrincipalId,
  })), [
    { canDelete: true, creatorName: 'Ada Lovelace', creatorPrincipalId: 'principal_a' },
    { canDelete: false, creatorName: 'Grace Hopper', creatorPrincipalId: 'principal_b' },
  ])
})

test('only a memory saved as owner-only reads as private', () => {
  const rows = memoriesToClientListRows([
    { _id: 'private', content: 'Mine', createdAt: 1, source: 'chat', userId: 'user_a', visibility: 'owner' as const },
    { _id: 'shared', content: 'Ours', createdAt: 2, source: 'chat', userId: 'user_a', visibility: 'workspace' as const },
    { _id: 'legacy', content: 'Old', createdAt: 3, source: 'chat', userId: 'user_a' },
  ], { viewerUserId: 'user_a' })
  assert.deepEqual(rows.map((row) => row.isPrivate), [true, false, false])
})

test('a full-length context brief is saved whole in at most the memory cap', async () => {
  const { MAX_MEMORY_INGESTION_CHUNKS, segmentMemoryForIngestion, segmentMemoryForSidebarDisplay } = await import('./memory-display-segments')
  const brief = Array.from({ length: 160 }, (_, index) => `- Fact ${index}: I lead the platform team and prefer short written updates over meetings.`).join('\n\n').slice(0, 20_000)
  assert.ok(segmentMemoryForSidebarDisplay(brief).length > MAX_MEMORY_INGESTION_CHUNKS)
  const chunks = segmentMemoryForIngestion(brief)
  assert.ok(chunks.length <= MAX_MEMORY_INGESTION_CHUNKS)
  assert.equal(chunks.join('\n\n').replace(/\s+/g, ' '), brief.replace(/\s+/g, ' ').trim())
})

test('a short paste keeps its ~300-character pieces', async () => {
  const { segmentMemoryForIngestion } = await import('./memory-display-segments')
  assert.deepEqual(segmentMemoryForIngestion('I prefer async updates.'), ['I prefer async updates.'])
})
