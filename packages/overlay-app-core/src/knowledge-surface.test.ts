import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KnowledgeSurfaceController,
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
  const evidence = await exerciseKnowledgeAdapterContract(adapters)
  assert.deepEqual(evidence.eventTypes, ['created', 'created', 'updated', 'moved', 'deleted'])
  assert.equal(evidence.finalCount, 2)
  assert.equal(adapters.evidence.routeWrites.at(-1)?.query, 'contract')
  assert.deepEqual(adapters.evidence.openedIds, ['navigation-contract'])
  assert.equal(adapters.evidence.analytics.at(-1)?.event, 'knowledge_contract_exercised')
})

test('controller distinguishes initial loading from background refresh and derives navigation state', async () => {
  const adapters = createFixtureKnowledgeSurfaceAdapters({ initialRoute: { folderId: 'fixture-folder' } })
  const controller = new KnowledgeSurfaceController(adapters)
  const initialLoad = controller.initialize()
  assert.equal(controller.getSnapshot().initialLoading, true)
  assert.equal(controller.getSnapshot().refreshing, false)
  await initialLoad
  assert.equal(controller.getSnapshot().initialLoading, false)
  assert.deepEqual(controller.getSnapshot().breadcrumbs.map((item) => item.label), ['Projects'])
  assert.deepEqual(controller.getSnapshot().visibleNodes.map((item) => item.name), ['Parity notes'])

  const refresh = controller.refresh()
  assert.equal(controller.getSnapshot().initialLoading, false)
  assert.equal(controller.getSnapshot().refreshing, true)
  await refresh
  assert.equal(controller.getSnapshot().refreshing, false)
  controller.dispose()
})

test('controller applies optimistic create, rename, move, delete, filtering, and selection', async () => {
  const adapters = createFixtureKnowledgeSurfaceAdapters()
  const controller = new KnowledgeSurfaceController(adapters)
  await controller.initialize()
  const created = await controller.create({ name: 'Draft', kind: 'file', parentId: null })
  assert.equal(controller.getSnapshot().nodes.filter((node) => node.id === created.id).length, 1)
  await controller.rename(created.id, 'Final')
  await controller.move(created.id, 'fixture-folder')
  controller.openFolder('fixture-folder')
  controller.setSearch('final')
  assert.deepEqual(controller.getSnapshot().visibleNodes.map((node) => node.name), ['Final'])
  controller.toggleSelection(created.id)
  assert.equal(controller.getSnapshot().selectedIds.has(created.id), true)
  await controller.delete([created.id])
  assert.equal(controller.getSnapshot().nodes.some((node) => node.id === created.id), false)
  assert.equal(controller.getSnapshot().selectedIds.size, 0)
  controller.dispose()
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
