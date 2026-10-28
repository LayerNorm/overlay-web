import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeCreateFolder,
  executeListFiles,
  executeMoveFile,
  executeReadFile,
  executeWriteFile,
} from './files-executes'
import type { OverlayToolsOptions } from './types'

const options: OverlayToolsOptions = { userId: 'user_1', workspaceId: 'ws_1', baseUrl: 'https://overlay.test' }

function mockFetch(handler: (url: URL, init?: RequestInit) => Response) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => handler(new URL(String(input)), init)) as typeof fetch
  return () => { globalThis.fetch = originalFetch }
}

test('read_file returns long text in chunks with a revision', async () => {
  const text = 'a'.repeat(70_000)
  const restore = mockFetch(() => Response.json({ _id: 'f1', name: 'big.txt', type: 'file', kind: 'upload', textContent: text, updatedAt: 7 }))
  try {
    const first = await executeReadFile(options, { fileId: 'f1' })
    assert.equal(first.success, true)
    assert.equal('content' in first && first.content.length, 60_000)
    assert.equal('nextOffset' in first && first.nextOffset, 60_000)
    assert.equal('file' in first && first.file.revision, '7')
    const rest = await executeReadFile(options, { fileId: 'f1', offset: 60_000 })
    assert.equal('content' in rest && rest.content.length, 10_000)
    assert.equal('nextOffset' in rest, false)
  } finally {
    restore()
  }
})

test('read_file points notes and folders at the right tool', async () => {
  const restore = mockFetch((url) => Response.json(
    url.searchParams.get('fileId') === 'n1'
      ? { _id: 'n1', name: 'Plan', type: 'file', kind: 'note', updatedAt: 1 }
      : { _id: 'd1', name: 'Docs', type: 'folder', kind: 'folder', updatedAt: 1 },
  ))
  try {
    assert.match(String((await executeReadFile(options, { fileId: 'n1' })).error), /get_note/)
    assert.match(String((await executeReadFile(options, { fileId: 'd1' })).error), /list_files/)
  } finally {
    restore()
  }
})

test('write_file creates with a mime type and reports a stale revision as a conflict', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    if (init?.method === 'PATCH') return Response.json({ error: 'The file changed since it was read.', conflict: true }, { status: 409 })
    return Response.json({ id: 'f2' })
  })
  try {
    assert.deepEqual(await executeWriteFile(options, { name: 'report.md', content: '# R', folderId: 'd1' }), {
      success: true,
      fileId: 'f2',
      saved: { name: 'report.md', path: 'd1' },
    })
    assert.equal(bodies[0]?.mimeType, 'text/markdown')
    assert.equal(bodies[0]?.parentId, 'd1')
    const conflict = await executeWriteFile(options, { fileId: 'f2', content: 'x', expectedRevision: '3' })
    assert.equal(conflict.success, false)
    assert.equal('conflict' in conflict && conflict.conflict, true)
    assert.equal(bodies[1]?.expectedUpdatedAt, 3)
  } finally {
    restore()
  }
})

test('file and folder writes echo persisted names and folder paths', async () => {
  const files = new Map<string, Record<string, unknown>>([
    ['d1', { _id: 'd1', name: 'Docs', type: 'folder', parentId: null, updatedAt: 1 }],
  ])
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const id = body.type === 'folder' ? 'folder_created' : 'file_created'
      files.set(id, {
        _id: id,
        name: body.type === 'folder' ? 'Persisted folder' : 'Persisted file.md',
        type: body.type,
        parentId: body.parentId ?? null,
        updatedAt: 2,
      })
      return Response.json({ id })
    }
    if (init.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const file = files.get(String(body.fileId))!
      if (body.name) file.name = body.name === 'Requested move' ? 'Persisted move' : 'Persisted edit'
      if ('parentId' in body) file.parentId = body.parentId
      return Response.json({ success: true })
    }
    const file = files.get(url.searchParams.get('fileId') ?? '')
    return file ? Response.json(file) : Response.json({ error: 'Not found' }, { status: 404 })
  }) as typeof fetch
  try {
    const created = await executeWriteFile(options, { name: 'Requested file.md', content: 'body', folderId: 'd1' })
    assert.deepEqual(created.saved, { name: 'Persisted file.md', path: 'Docs' })

    const updated = await executeWriteFile(options, {
      fileId: 'file_created', name: 'Requested edit', content: 'new body',
    })
    assert.deepEqual(updated.saved, { name: 'Persisted edit', path: 'Docs' })

    const moved = await executeMoveFile(options, {
      fileId: 'file_created', folderId: null, name: 'Requested move',
    })
    assert.deepEqual(moved.saved, { name: 'Persisted move', path: 'Library' })

    const folder = await executeCreateFolder(options, { name: 'Requested folder', parentId: 'd1' })
    assert.deepEqual(folder.saved, { name: 'Persisted folder', path: 'Docs' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('write_file links only created files to its conversation', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const restore = mockFetch((_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return Response.json({ id: 'f2' })
  })
  const conversationOptions = { ...options, conversationId: 'conv_1' }
  try {
    await executeWriteFile(conversationOptions, { name: 'thread.md', content: '# Thread' })
    await executeWriteFile(options, { name: 'standalone.md', content: '# Standalone' })
    await executeWriteFile(conversationOptions, { fileId: 'f2', content: '# Edited' })

    assert.equal(bodies[0]?.conversationId, 'conv_1')
    assert.equal('conversationId' in (bodies[1] ?? {}), false)
    assert.equal('conversationId' in (bodies[2] ?? {}), false)
  } finally {
    restore()
  }
})

test('list_files pages past the endpoint\'s 100-row cap', async () => {
  const cursors: Array<string | null> = []
  const restore = mockFetch((url) => {
    cursors.push(url.searchParams.get('cursor'))
    const first = !url.searchParams.get('cursor')
    const data = Array.from({ length: first ? 100 : 30 }, (_, index) => ({ _id: `f${first ? index : 100 + index}`, name: 'x', type: 'file', updatedAt: 1 }))
    return Response.json({ data, nextCursor: first ? 'c2' : null, hasMore: first })
  })
  try {
    const result = await executeListFiles(options, {})
    assert.equal('files' in result && result.files.length, 130)
    assert.equal('truncated' in result, false)
    assert.deepEqual(cursors, [null, 'c2'])
  } finally {
    restore()
  }
})
