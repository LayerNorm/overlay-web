import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildKnowledgeBreadcrumbs,
  canMoveKnowledgeSurfaceNode,
  filterKnowledgeSurfaceNodes,
  normalizeKnowledgeSurfaceNode,
} from './knowledge-surface'
import {
  createFixtureKnowledgeSurfaceAdapters,
  exerciseKnowledgeAdapterContract,
} from './knowledge-surface-fixture'

test('fixture adapters satisfy the complete knowledge surface contract', async () => {
  const adapters = createFixtureKnowledgeSurfaceAdapters()
  const before = adapters.repository.nodes().length
  await exerciseKnowledgeAdapterContract(adapters)
  assert.equal(adapters.repository.nodes().length, before)
  assert.equal(adapters.evidence.routeWrites.at(-1)?.query, 'contract')
  assert.deepEqual(adapters.evidence.openedIds, ['navigation-contract'])
  assert.equal(adapters.evidence.analytics.at(-1)?.event, 'knowledge_contract_exercised')
})

test('normalization, breadcrumbs, filtering, and move guards are platform neutral', () => {
  const folder = normalizeKnowledgeSurfaceNode({
    _id: 'folder', name: 'Folder', type: 'folder', kind: 'folder', parentId: null, createdAt: 1, updatedAt: 1,
  })
  const note = normalizeKnowledgeSurfaceNode({
    _id: 'note', name: 'Résumé.md', type: 'note', kind: 'note', parentId: 'folder', createdAt: 1, updatedAt: 2,
  })
  assert.equal(note.type, 'file')
  assert.equal(note.kind, 'note')
  assert.deepEqual(buildKnowledgeBreadcrumbs([folder, note], 'folder'), [{ id: 'folder', label: 'Folder' }])
  assert.deepEqual(
    filterKnowledgeSurfaceNodes([folder, note], { folderId: 'folder', query: 'rés' }, { kinds: ['note'] }).map((node) => node.id),
    ['note'],
  )
  assert.equal(canMoveKnowledgeSurfaceNode([folder, note], 'folder', 'note'), false)
})

test('filtering a large folder remains bounded and deterministic', () => {
  const nodes = Array.from({ length: 10_000 }, (_, index) => normalizeKnowledgeSurfaceNode({
    _id: `large-${index}`,
    name: `Document ${String(index).padStart(5, '0')}`,
    type: 'file',
    kind: 'upload',
    parentId: null,
    createdAt: index,
    updatedAt: index,
  }))
  const startedAt = performance.now()
  const visible = filterKnowledgeSurfaceNodes(nodes, { folderId: null, query: '999' }, { kinds: ['file'] })
  assert.ok(performance.now() - startedAt < 250)
  assert.equal(visible.length, 19)
})
