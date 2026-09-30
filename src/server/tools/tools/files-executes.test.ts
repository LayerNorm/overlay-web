import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeReadFile, executeWriteFile } from './files-executes'
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
    assert.deepEqual(await executeWriteFile(options, { name: 'report.md', content: '# R', folderId: 'd1' }), { success: true, fileId: 'f2' })
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
