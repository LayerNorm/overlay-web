import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeAppendToNote,
  executeEditNote,
  executeGetNote,
  executeReplaceNoteSection,
} from './notes-executes'
import type { OverlayToolsOptions } from './types'

const options: OverlayToolsOptions = { userId: 'user_1', workspaceId: 'ws_1', baseUrl: 'https://overlay.test' }

type Stored = { content: string; updatedAt: number }

/** In-memory `/api/v1/notes` with the route's revision-conflict behavior. */
function mockNotesApi(note: Stored, hooks: { beforeWrite?: () => void } = {}) {
  const writes: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/api/v1/notes')
    assert.equal(new Headers(init?.headers).get('X-Overlay-Workspace-Id'), 'ws_1')
    if (!init?.method || init.method === 'GET') {
      return Response.json({ _id: 'note_1', title: 'Doc', tags: [], createdAt: 1, ...note })
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push(body)
    hooks.beforeWrite?.()
    if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== note.updatedAt) {
      return Response.json({ conflict: { remoteRevision: String(note.updatedAt) } }, { status: 409 })
    }
    note.content = String(body.content)
    note.updatedAt += 1
    return Response.json({ success: true, note: { _id: 'note_1', title: 'Doc', tags: [], createdAt: 1, ...note } })
  }) as typeof fetch
  return { writes, restore: () => { globalThis.fetch = originalFetch } }
}

test('get_note returns Markdown, a revision, and the outline', async () => {
  const api = mockNotesApi({ content: '# Doc\n\n## Tasks\n\n- a\n', updatedAt: 10 })
  try {
    const result = await executeGetNote(options, { noteId: 'note_1' })
    assert.equal(result.success, true)
    assert.deepEqual('note' in result ? result.note : null, {
      noteId: 'note_1',
      title: 'Doc',
      content: '# Doc\n\n## Tasks\n\n- a\n',
      tags: [],
      revision: '10',
      outline: [{ level: 1, text: 'Doc' }, { level: 2, text: 'Tasks' }],
      updatedAt: 10,
    })
  } finally {
    api.restore()
  }
})

test('patch tools write guarded by the revision they read', async () => {
  const note = { content: '# Doc\n\n## Tasks\n\n- a\n', updatedAt: 10 }
  const api = mockNotesApi(note)
  try {
    assert.deepEqual(await executeAppendToNote(options, { noteId: 'note_1', content: '## Log\n\nstarted' }), {
      success: true,
      noteId: 'note_1',
      revision: '11',
    })
    assert.equal(api.writes[0]?.expectedUpdatedAt, 10)
    assert.equal(note.content, '# Doc\n\n## Tasks\n\n- a\n\n## Log\n\nstarted\n')

    await executeReplaceNoteSection(options, { noteId: 'note_1', heading: 'Tasks', content: '- b' })
    assert.equal(note.content, '# Doc\n\n## Tasks\n\n- b\n\n## Log\n\nstarted\n')

    const failed = await executeEditNote(options, { noteId: 'note_1', edits: [{ find: 'missing', replace: 'x' }] })
    assert.equal(failed.success, false)
    assert.match('error' in failed ? failed.error : '', /was not in the note/)
    assert.equal(api.writes.length, 2)
  } finally {
    api.restore()
  }
})

test('a stale expectedRevision is refused without writing', async () => {
  const api = mockNotesApi({ content: 'x\n', updatedAt: 12 })
  try {
    const result = await executeEditNote(options, {
      noteId: 'note_1',
      edits: [{ find: 'x', replace: 'y' }],
      expectedRevision: '11',
    })
    assert.equal(result.success, false)
    assert.equal('conflict' in result && result.conflict, true)
    assert.equal(api.writes.length, 0)
  } finally {
    api.restore()
  }
})

test('a lost race is retried once on the fresh text', async () => {
  const note = { content: 'hello\n', updatedAt: 1 }
  let raced = false
  const api = mockNotesApi(note, {
    beforeWrite: () => {
      if (raced) return
      raced = true
      // The user types between our read and our write.
      note.content = 'hello world\n'
      note.updatedAt = 2
    },
  })
  try {
    const result = await executeAppendToNote(options, { noteId: 'note_1', content: 'appended' })
    assert.equal(result.success, true)
    assert.equal(note.content, 'hello world\n\nappended\n')
    assert.deepEqual(api.writes.map((write) => write.expectedUpdatedAt), [1, 2])
  } finally {
    api.restore()
  }
})
