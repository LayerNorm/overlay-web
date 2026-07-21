import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KnowledgeMutationConsumer,
  KnowledgeSurfaceController,
  buildKnowledgeBreadcrumbs,
  canMoveKnowledgeSurfaceNode,
  createKnowledgeMutationPublisher,
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

test('payload mutations patch and delete one entity without refetching the list', async () => {
  let listReads = 0
  let detailReads = 0
  const events: string[] = []
  const consumer = new KnowledgeMutationConsumer({
    origin: 'web-local',
    repository: {
      async list() {
        listReads += 1
        return { nodes: [] }
      },
      async get(id) {
        detailReads += 1
        return normalizeKnowledgeSurfaceNode({
          _id: id, name: `File ${id}`, type: 'file', kind: 'upload', parentId: null, createdAt: 1, updatedAt: 2,
        })
      },
    },
    apply(event) { events.push(event.type) },
  })
  const publish = createKnowledgeMutationPublisher('desktop-window')
  await consumer.handle(publish({ entity: 'file', id: 'a', operation: 'updated' }))
  await consumer.handle(publish({ entity: 'file', id: 'a', operation: 'deleted' }))
  assert.deepEqual(events, ['updated', 'deleted'])
  assert.equal(detailReads, 1)
  assert.equal(listReads, 0)
  consumer.dispose()
})

test('a missed mutation revision is the only mutation path that reconciles the list', async () => {
  let listReads = 0
  const events: string[] = []
  const consumer = new KnowledgeMutationConsumer({
    origin: 'web-local',
    repository: {
      async list() {
        listReads += 1
        return { nodes: [], revision: 'server-2' }
      },
      async get() { return null },
    },
    apply(event) { events.push(event.type) },
  })
  await consumer.handle({ entity: 'file', id: 'a', operation: 'deleted', revision: '1', origin: 'desktop-window' })
  await consumer.handle({ entity: 'file', id: 'b', operation: 'deleted', revision: '3', origin: 'desktop-window' })
  assert.equal(listReads, 1)
  assert.deepEqual(events, ['deleted', 'reset'])
  consumer.dispose()
})

test('newer detail mutations cancel and suppress stale file requests', async () => {
  let calls = 0
  let staleAborted = false
  const names: string[] = []
  const consumer = new KnowledgeMutationConsumer({
    origin: 'web-local',
    repository: {
      async list() { return { nodes: [] } },
      async get() { return null },
    },
    loadNode(mutation, signal) {
      calls += 1
      if (calls === 1) {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
          staleAborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true }))
      }
      return Promise.resolve(normalizeKnowledgeSurfaceNode({
        _id: mutation.id, name: 'Current detail', type: 'file', kind: 'upload', parentId: null, createdAt: 1, updatedAt: 2,
      }))
    },
    apply(event) {
      if (event.type === 'updated') names.push(event.node.name)
    },
  })
  const stale = consumer.handle({ entity: 'file', id: 'same', operation: 'updated', revision: '1', origin: 'desktop-window' })
  const current = consumer.handle({ entity: 'file', id: 'same', operation: 'updated', revision: '2', origin: 'desktop-window' })
  await Promise.all([stale, current])
  assert.equal(staleAborted, true)
  assert.deepEqual(names, ['Current detail'])
  consumer.dispose()
})

test('stale refreshes are aborted and cannot replace a newer list', async () => {
  const resolvers: Array<(nodes: ReturnType<typeof normalizeKnowledgeSurfaceNode>[]) => void> = []
  const adapters = createFixtureKnowledgeSurfaceAdapters()
  adapters.repository.list = (signal) => new Promise((resolve, reject) => {
    resolvers.push((nodes) => resolve({ nodes }))
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const controller = new KnowledgeSurfaceController(adapters)
  const stale = controller.refresh()
  const current = controller.refresh()
  resolvers[1]!([normalizeKnowledgeSurfaceNode({
    _id: 'current', name: 'Current', type: 'file', kind: 'upload', parentId: null, createdAt: 1, updatedAt: 2,
  })])
  await current
  await stale
  assert.deepEqual(controller.getSnapshot().nodes.map((node) => node.id), ['current'])
  controller.dispose()
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
