import assert from 'node:assert/strict'
import test from 'node:test'
import {
  exerciseKnowledgeAdapterContract,
  normalizeKnowledgeSurfaceNode,
  type FilePickerAdapter,
  type KnowledgeFile,
} from '@overlay/app-core'
import {
  createWebKnowledgeRepository,
  createWebKnowledgeRouteAdapter,
  createWebKnowledgeSurfaceAdapters,
  type WebKnowledgeAppClient,
} from './webKnowledgeSurfaceAdapters'

function createClient(): WebKnowledgeAppClient {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  let sequence = 0
  let files: KnowledgeFile[] = [
    { _id: 'seed', name: 'Seed.txt', type: 'file', kind: 'upload', parentId: null, createdAt: now, updatedAt: now },
  ]
  return {
    files: {
      async get<T>() {
        return files as T
      },
      async getResponse({ fileId }) {
        const file = files.find((candidate) => candidate._id === fileId)
        return file ? Response.json(file) : new Response(null, { status: 404 })
      },
      async createResponse(input) {
        sequence += 1
        const file: KnowledgeFile = {
          _id: `web-${sequence}`,
          name: String(input.name),
          type: input.type === 'folder' ? 'folder' : 'file',
          kind: String(input.kind ?? 'upload'),
          parentId: typeof input.parentId === 'string' ? input.parentId : null,
          content: typeof input.content === 'string' ? input.content : undefined,
          createdAt: now + sequence,
          updatedAt: now + sequence,
        }
        files = [...files, file]
        return Response.json({ id: file._id, file })
      },
      async updateResponse(input) {
        files = files.map((file) => file._id === input.fileId ? {
          ...file,
          name: typeof input.name === 'string' ? input.name : file.name,
          parentId: 'parentId' in input ? (input.parentId as string | null) : file.parentId,
          updatedAt: file.updatedAt + 1,
        } : file)
        return Response.json({ success: true })
      },
      async deleteResponse({ fileId }) {
        const deleted = new Set([fileId])
        let changed = true
        while (changed) {
          changed = false
          for (const file of files) {
            if (file.parentId && deleted.has(file.parentId) && !deleted.has(file._id)) {
              deleted.add(file._id)
              changed = true
            }
          }
        }
        files = files.filter((file) => !deleted.has(file._id))
        return new Response(null, { status: 204 })
      },
    },
    notes: {
      async get<T>() {
        return [] as T
      },
      async deleteResponse() {
        return new Response(null, { status: 204 })
      },
    },
  }
}

test('web adapters satisfy the platform-neutral knowledge contract', async () => {
  let currentUrl = new URL('https://getoverlay.io/app/files?layout=list')
  const route = createWebKnowledgeRouteAdapter({
    currentUrl: () => currentUrl,
    navigate(url) {
      currentUrl = new URL(url, currentUrl)
    },
    eventTarget: {
      addEventListener() {},
      removeEventListener() {},
    } as Pick<Window, 'addEventListener' | 'removeEventListener'>,
  })
  const picker: FilePickerAdapter = { async pickFiles() { return [] } }
  const opened: string[] = []
  const analytics: string[] = []
  const adapters = createWebKnowledgeSurfaceAdapters({
    client: createClient(),
    route,
    filePicker: picker,
    navigate: (url) => opened.push(url),
    capture: (event) => analytics.push(event),
  })
  const evidence = await exerciseKnowledgeAdapterContract(adapters)
  assert.equal(evidence.finalCount, 1)
  assert.equal(currentUrl.searchParams.get('q'), 'contract')
  assert.equal(currentUrl.searchParams.get('layout'), 'cards')
  assert.deepEqual(opened, ['/app/files?file=navigation-contract'])
  assert.deepEqual(analytics, ['knowledge_contract_exercised'])
})

test('web navigation preserves note editor compatibility', () => {
  const opened: string[] = []
  const adapters = createWebKnowledgeSurfaceAdapters({
    client: createClient(),
    route: createWebKnowledgeRouteAdapter({
      currentUrl: () => new URL('https://getoverlay.io/app/files'),
      navigate() {},
      eventTarget: { addEventListener() {}, removeEventListener() {} } as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    }),
    filePicker: { async pickFiles() { return [] } },
    navigate: (url) => opened.push(url),
    capture() {},
  })
  adapters.navigation.open(normalizeKnowledgeSurfaceNode({
    _id: 'note', name: 'Note', type: 'note', kind: 'note', parentId: null, createdAt: 1, updatedAt: 1,
  }))
  assert.deepEqual(opened, ['/app/notes?id=note'])
})

test('opening 100 web files causes zero list refetches', async () => {
  let fileLists = 0
  const client = createClient()
  const originalGet = client.files.get
  client.files.get = async function <T>(query?: { limit?: number }) {
    fileLists += 1
    return originalGet<T>(query)
  }
  const opened: string[] = []
  const adapters = createWebKnowledgeSurfaceAdapters({
    client,
    route: createWebKnowledgeRouteAdapter({
      currentUrl: () => new URL('https://getoverlay.io/app/files'),
      navigate() {},
      eventTarget: { addEventListener() {}, removeEventListener() {} } as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    }),
    filePicker: { async pickFiles() { return [] } },
    navigate: (url) => opened.push(url),
    capture() {},
    eventTarget: null,
  })
  const snapshot = await adapters.repository.list()
  for (let index = 0; index < 100; index += 1) await adapters.navigation.open(snapshot.nodes[0]!)
  assert.equal(fileLists, 1)
  assert.equal(opened.length, 100)
})

test('web repositories consume mutation payloads without refetching the list', async () => {
  let fileLists = 0
  const client = createClient()
  const originalGet = client.files.get
  client.files.get = async function <T>(query?: { limit?: number }) {
    fileLists += 1
    return originalGet<T>(query)
  }
  const target = new EventTarget() as unknown as Window
  const producer = createWebKnowledgeRepository(client, target, 'web-producer')
  const consumer = createWebKnowledgeRepository(client, target, 'web-consumer')
  await producer.list()
  await consumer.list()
  const names: string[] = []
  const unsubscribe = consumer.subscribe((event) => {
    if (event.type === 'updated') names.push(event.node.name)
  })
  await producer.rename({ id: 'seed', name: 'Payload update' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(names.includes('Payload update'))
  assert.equal(fileLists, 2)
  unsubscribe()
})
