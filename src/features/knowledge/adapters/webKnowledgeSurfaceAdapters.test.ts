import assert from 'node:assert/strict'
import test from 'node:test'
import {
  exerciseKnowledgeAdapterContract,
  normalizeKnowledgeSurfaceNode,
  type FilePickerAdapter,
  type KnowledgeFile,
} from '@overlay/app-core'
import {
  createWebKnowledgeRouteAdapter,
  createWebKnowledgeSurfaceAdapters,
  type WebKnowledgeAppClient,
  type WebKnowledgeTreeCommands,
} from './webKnowledgeSurfaceAdapters'

function commandsFor(client: WebKnowledgeAppClient & { files: { updateResponse(input: Record<string, unknown>): Promise<Response> } }): WebKnowledgeTreeCommands {
  return {
    async rename(fileId, name) { await client.files.updateResponse({ fileId, name }) },
    async move(fileId, parentId) { await client.files.updateResponse({ fileId, parentId }) },
  }
}

function createClient(): WebKnowledgeAppClient & { files: { updateResponse(input: Record<string, unknown>): Promise<Response> } } {
  const now = Date.parse('2026-07-20T12:00:00.000Z')
  let sequence = 0
  let files: KnowledgeFile[] = [
    { _id: 'seed', name: 'Seed.txt', type: 'file', kind: 'upload', parentId: null, createdAt: now, updatedAt: now },
  ]
  return {
    files: {
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
      async updateResponse(input: Record<string, unknown>) {
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
  const client = createClient()
  const adapters = createWebKnowledgeSurfaceAdapters({
    commands: commandsFor(client),
    client,
    route,
    filePicker: picker,
    navigate: (url) => opened.push(url),
    capture: (event) => analytics.push(event),
  })
  await exerciseKnowledgeAdapterContract(adapters)
  assert.equal(currentUrl.searchParams.get('q'), 'contract')
  assert.equal(currentUrl.searchParams.get('layout'), 'cards')
  assert.deepEqual(opened, ['/app/files?file=navigation-contract'])
  assert.deepEqual(analytics, ['knowledge_contract_exercised'])
})

test('saved text uploads open as complete files while actual notes retain the note editor', async () => {
  const client = createClient(), opened: string[] = []
  const fullText = 'Full saved upload ✓\n' + '0123456789abcdef'.repeat(17000) + '\nEND_SAVED_UPLOAD'
  client.files.getResponse = async ({ fileId, fullText: includeFullText }) => Response.json({
    _id: fileId, name: 'payload.txt', type: 'file', kind: 'upload', mimeType: 'text/plain',
    createdAt: 1, updatedAt: 1, content: includeFullText ? fullText : fullText.slice(0, 128 * 1024),
  })
  const adapters = createWebKnowledgeSurfaceAdapters({ commands: commandsFor(client), client, navigate: url => opened.push(url) })
  const file = await adapters.repository.get('saved-upload')
  assert.ok(file)
  assert.ok(file.content === fullText, 'Opening a file must load its full content rather than its searchable prefix')
  await adapters.navigation.open(file)
  assert.deepEqual(opened, ['/app/files?file=saved-upload'])
})

test('web navigation preserves note editor compatibility', () => {
  const opened: string[] = []
  const client = createClient()
  const adapters = createWebKnowledgeSurfaceAdapters({
    commands: commandsFor(client),
    client,
    currentUrl: () => new URL('https://getoverlay.io/w/team/workspace/files'),
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
  assert.deepEqual(opened, ['/w/team/workspace/notes?id=note'])
})
