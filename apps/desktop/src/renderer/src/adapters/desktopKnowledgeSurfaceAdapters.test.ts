import {
  exerciseKnowledgeAdapterContract,
  type FilePickerAdapter,
  type KnowledgeFile
} from '@overlay/app-core'
import { describe, expect, it } from 'vitest'
import {
  createDesktopKnowledgeRouteAdapter,
  createDesktopKnowledgeRepository,
  createDesktopKnowledgeSurfaceAdapters,
  type DesktopKnowledgeAppClient,
  type DesktopNoteReplicaPort
} from './desktopKnowledgeSurfaceAdapters'

function createClient(counters = { fileLists: 0, noteLists: 0 }): DesktopKnowledgeAppClient {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  let sequence = 0
  let files: KnowledgeFile[] = [
    {
      _id: 'desktop-seed',
      name: 'Desktop seed.txt',
      type: 'file',
      kind: 'upload',
      parentId: null,
      createdAt: now,
      updatedAt: now
    }
  ]
  return {
    files: {
      async get<T>() {
        counters.fileLists += 1
        return files as T
      },
      async getResponse({ fileId }) {
        const file = files.find((candidate) => candidate._id === fileId)
        return file ? Response.json(file) : new Response(null, { status: 404 })
      },
      async createResponse(input) {
        sequence += 1
        const file: KnowledgeFile = {
          _id: `desktop-${sequence}`,
          name: String(input.name),
          type: input.type === 'folder' ? 'folder' : 'file',
          kind: String(input.kind ?? 'upload'),
          parentId: typeof input.parentId === 'string' ? input.parentId : null,
          content: typeof input.content === 'string' ? input.content : undefined,
          createdAt: now + sequence,
          updatedAt: now + sequence
        }
        files = [...files, file]
        return Response.json({ id: file._id, file })
      },
      async updateResponse(input) {
        files = files.map((file) =>
          file._id === input.fileId
            ? {
                ...file,
                name: typeof input.name === 'string' ? input.name : file.name,
                parentId:
                  'parentId' in input ? (input.parentId as string | null) : file.parentId,
                updatedAt: file.updatedAt + 1
              }
            : file
        )
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
      }
    },
    notes: {
      async get<T>() {
        counters.noteLists += 1
        return [] as T
      },
      async deleteResponse() {
        return new Response(null, { status: 204 })
      }
    }
  }
}

describe('desktop knowledge surface adapters', () => {
  it('satisfies the same platform-neutral contract as web and fixtures', async () => {
    const location = { href: 'http://localhost:5173/?window=main&layout=list' }
    const route = createDesktopKnowledgeRouteAdapter({
      location,
      navigate(url) {
        location.href = new URL(url, location.href).href
      },
      eventTarget: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      } as Pick<Window, 'addEventListener' | 'removeEventListener'>
    })
    const picker: FilePickerAdapter = { async pickFiles() { return [] } }
    const opened: string[] = []
    const analytics: string[] = []
    const adapters = createDesktopKnowledgeSurfaceAdapters({
      client: createClient(),
      route,
      filePicker: picker,
      onOpenFile: (id) => opened.push(id),
      capture: (event) => analytics.push(event)
    })
    const evidence = await exerciseKnowledgeAdapterContract(adapters)
    expect(evidence.finalCount).toBe(1)
    expect(new URL(location.href).searchParams.get('q')).toBe('contract')
    expect(new URL(location.href).searchParams.get('layout')).toBe('cards')
    expect(opened).toEqual(['navigation-contract'])
    expect(analytics).toEqual(['knowledge_contract_exercised'])
  })

  it('opens 100 files without refetching the list', async () => {
    const counters = { fileLists: 0, noteLists: 0 }
    const opened: string[] = []
    const adapters = createDesktopKnowledgeSurfaceAdapters({
      client: createClient(counters),
      route: createDesktopKnowledgeRouteAdapter({
        location: { href: 'http://localhost:5173/?window=main' },
        navigate: () => undefined,
        eventTarget: {
          addEventListener: () => undefined,
          removeEventListener: () => undefined
        } as Pick<Window, 'addEventListener' | 'removeEventListener'>
      }),
      filePicker: { async pickFiles() { return [] } },
      onOpenFile: (id) => opened.push(id)
    })
    const snapshot = await adapters.repository.list()
    for (let index = 0; index < 100; index += 1) await adapters.navigation.open(snapshot.nodes[0]!)
    expect(opened).toHaveLength(100)
    expect(new Set(opened)).toEqual(new Set(['desktop-seed']))
    expect(counters).toEqual({ fileLists: 1, noteLists: 1 })
  })

  it('applies payload-bearing cross-surface mutations without a list refetch', async () => {
    const counters = { fileLists: 0, noteLists: 0 }
    const target = new EventTarget() as unknown as Window
    const client = createClient(counters)
    const producer = createDesktopKnowledgeRepository(client, target, undefined, 'desktop-producer')
    const consumer = createDesktopKnowledgeRepository(client, target, undefined, 'desktop-consumer')
    await producer.list()
    await consumer.list()
    const updated: string[] = []
    const unsubscribe = consumer.subscribe((event) => {
      if (event.type === 'updated') updated.push(event.node.name)
    })
    await producer.rename({ id: 'desktop-seed', name: 'Renamed without refetch' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updated).toContain('Renamed without refetch')
    expect(counters).toEqual({ fileLists: 2, noteLists: 2 })
    unsubscribe()
  })

  it('projects local note saves incrementally without a list refetch', async () => {
    const counters = { fileLists: 0, noteLists: 0 }
    let publish: ((notes: readonly { id: string; title: string; updatedAt: number }[]) => void) | undefined
    const replicas: DesktopNoteReplicaPort = {
      async ensure(node) { return node.clientId ?? `note-remote-${node.id}` },
      async remove() { return },
      subscribe(listener) {
        publish = listener
        return () => { publish = undefined }
      }
    }
    const repository = createDesktopKnowledgeRepository(createClient(counters), null, replicas)
    const note = await repository.create({ name: 'Local note', kind: 'note', parentId: null, content: '' })
    await repository.list()
    const events: string[] = []
    const unsubscribe = repository.subscribe((event) => {
      if (event.type === 'updated') events.push(event.node.name)
    })
    publish?.([{ id: `note-remote-${note.id}`, title: 'Saved locally', updatedAt: note.updatedAt + 1 }])
    expect(events).toEqual(['Saved locally'])
    expect(counters).toEqual({ fileLists: 1, noteLists: 1 })
    unsubscribe()
  })
})
