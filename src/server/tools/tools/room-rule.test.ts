import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from 'ai'
import { executeListFiles } from './files-executes'
import { executeGetNote, executeListNotes } from './notes-executes'
import { executeListAutomations, executeListSkills, executeSearchKnowledge, executeSearchMemory, executeSearchMessages } from './overlay-executes'
import { roomListScope, ROOM_PERSONAL_ITEM_ERROR } from './room-scope'
import type { OverlayToolsOptions } from './types'
import { withoutSharedRoomWithheldTools, workspaceToolsOnly } from '../shared-room-policy'

const alone: OverlayToolsOptions = { userId: 'user_1', workspaceId: 'ws_1', baseUrl: 'https://overlay.test' }
const inRoom: OverlayToolsOptions = { ...alone, sharedRoom: true }

type Seen = { url: URL; body: Record<string, unknown> | null }

/** Records every request the tools make and answers with an empty successful page. */
async function recording(run: () => Promise<unknown>): Promise<Seen[]> {
  const seen: Seen[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    seen.push({ url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null })
    return Response.json({ data: [], chunks: [], hasMore: false, nextCursor: null })
  }) as typeof fetch
  try { await run() } finally { globalThis.fetch = original }
  return seen
}

test('the search tools ask for workspace-only results in a shared room, and not elsewhere', async () => {
  for (const [name, call] of [
    ['search_knowledge', (o: OverlayToolsOptions) => executeSearchKnowledge(o, { query: 'plans' })],
    ['search_memory', (o: OverlayToolsOptions) => executeSearchMemory(o, { query: 'plans' })],
    ['search_messages', (o: OverlayToolsOptions) => executeSearchMessages(o, { query: 'plans' })],
  ] as const) {
    const [shared] = await recording(() => call(inRoom))
    assert.equal(shared?.body?.workspaceOnly, true, `${name} in a shared room`)
    const [own] = await recording(() => call(alone))
    assert.equal(own?.body?.workspaceOnly, undefined, `${name} for one person`)
  }
})

test('the list tools read only the Workspace scope in a shared room, whatever the model asked for', async () => {
  const lists = [
    (o: OverlayToolsOptions, scope?: 'personal') => executeListNotes(o, { scope }),
    (o: OverlayToolsOptions, scope?: 'personal') => executeListFiles(o, { scope }),
    (o: OverlayToolsOptions, scope?: 'personal') => executeListSkills(o, { scope }),
    (o: OverlayToolsOptions, scope?: 'personal') => executeListAutomations(o, { scope }),
  ]
  for (const list of lists) {
    const [asked] = await recording(() => list(inRoom, 'personal'))
    assert.equal(asked?.url.searchParams.get('view'), 'workspace')
    const [unasked] = await recording(() => list(inRoom))
    assert.equal(unasked?.url.searchParams.get('view'), 'workspace')
    const [elsewhere] = await recording(() => list(alone, 'personal'))
    assert.equal(elsewhere?.url.searchParams.get('view'), 'personal')
    const [everything] = await recording(() => list(alone))
    assert.equal(everything?.url.searchParams.get('view'), null)
  }
})

test('the room scope is the Workspace scope in a shared room and the request otherwise', () => {
  assert.equal(roomListScope(inRoom, 'personal'), 'workspace')
  assert.equal(roomListScope(inRoom, undefined), 'workspace')
  assert.equal(roomListScope(alone, 'archived'), 'archived')
  assert.equal(roomListScope(alone, undefined), undefined)
})

test('tools that read the person’s own chats and file text are not offered in a shared room', () => {
  assert.deepEqual(
    withoutSharedRoomWithheldTools(['search_knowledge', 'list_chats', 'read_chat', 'search_in_files', 'list_files']),
    ['search_knowledge', 'list_files'],
  )
})

test('only the workspace’s connected-account tools are offered in a shared room', () => {
  const tools = { GMAIL_SEND: {}, workspace_GMAIL_SEND: {}, workspace_SLACK_POST: {}, SLACK_POST: {} } as unknown as ToolSet
  assert.deepEqual(Object.keys(workspaceToolsOnly(tools)).sort(), ['workspace_GMAIL_SEND', 'workspace_SLACK_POST'])
})

/** Answers GETs with one item of the given scope and records every write. */
async function withItem(scope: 'personal' | 'workspace' | undefined, run: () => Promise<unknown>) {
  const writes: Seen[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    if (!init?.method || init.method === 'GET') {
      const item = { _id: 'item_1', title: 'Plan', name: 'plan.md', type: 'file', kind: 'upload', content: '# Plan', textContent: 'text',
        updatedAt: 5, tags: [], priority: 2, status: 'todo', ...(scope ? { scope } : {}) }
      return Response.json(url.pathname.startsWith('/api/v1/work') ? { item, events: [], people: [], items: [] } : item)
    }
    writes.push({ url, body })
    return Response.json({ success: true, id: 'new_1', item: { _id: 'new_1', title: 'T', priority: 2, status: 'todo', updatedAt: 1 } })
  }) as typeof fetch
  try { return { result: await run() as { success: boolean; error?: string }, writes } } finally { globalThis.fetch = original }
}

test('in a shared room, reads and edits by id reach only Workspace items', async () => {
  const { executeReadFile, executeWriteFile, executeMoveFile } = await import('./files-executes')
  const { executeGetNote, executeUpdateNote, executeDeleteNote, executeAppendToNote } = await import('./notes-executes')
  const { executeGetTask, executeUpdateTask, executeCommentOnTask } = await import('./work-executes')
  const calls: Array<[string, (o: OverlayToolsOptions) => Promise<unknown>]> = [
    ['read_file', (o) => executeReadFile(o, { fileId: 'item_1' })],
    ['write_file', (o) => executeWriteFile(o, { fileId: 'item_1', content: 'x' })],
    ['move_file', (o) => executeMoveFile(o, { fileId: 'item_1', name: 'b.md' })],
    ['get_note', (o) => executeGetNote(o, { noteId: 'item_1' })],
    ['append_to_note', (o) => executeAppendToNote(o, { noteId: 'item_1', content: 'more' } as never)],
    ['update_note', (o) => executeUpdateNote(o, { noteId: 'item_1', content: 'x' })],
    ['delete_note', (o) => executeDeleteNote(o, { noteId: 'item_1' })],
    ['get_task', (o) => executeGetTask(o, { taskId: 'item_1' })],
    ['update_task', (o) => executeUpdateTask(o, { taskId: 'item_1', title: 'x' })],
    ['comment_on_task', (o) => executeCommentOnTask(o, { taskId: 'item_1', body: 'x' })],
  ]
  for (const [name, call] of calls) {
    for (const scope of ['personal', undefined] as const) {
      const { result, writes } = await withItem(scope, () => call(inRoom))
      assert.equal(result.success, false, `${name} refuses a ${scope ?? 'unscoped'} item in a shared room`)
      assert.match(result.error ?? '', /Personal/, name)
      assert.equal(writes.length, 0, `${name} writes nothing`)
    }
    const { result: personalAlone } = await withItem('personal', () => call(alone))
    assert.doesNotMatch(personalAlone.error ?? '', /room others can read/, `${name} is not refused for one person`)
    const { result: shared } = await withItem('workspace', () => call(inRoom))
    assert.doesNotMatch(shared.error ?? '', /room others can read/, `${name} reaches a Workspace item in a shared room`)
  }
})

test('new items land in Workspace in a shared room, and as asked (Personal by default) elsewhere', async () => {
  const { executeWriteFile, executeCreateFolder } = await import('./files-executes')
  const { executeCreateNote } = await import('./notes-executes')
  const { executeCreateTask } = await import('./work-executes')
  const { executeCreateAutomation } = await import('./overlay-executes')
  const schedule = { kind: 'daily', hour: 9, minute: 0 } as never
  const creates: Array<[string, (o: OverlayToolsOptions, scope?: 'personal' | 'workspace') => Promise<unknown>]> = [
    ['write_file', (o, scope) => executeWriteFile(o, { name: 'a.md', content: 'x', ...(scope ? { scope } : {}) })],
    ['create_folder', (o, scope) => executeCreateFolder(o, { name: 'A', ...(scope ? { scope } : {}) })],
    ['create_note', (o, scope) => executeCreateNote(o, { content: 'x', ...(scope ? { scope } : {}) })],
    ['create_task', (o, scope) => executeCreateTask(o, { title: 'T', ...(scope ? { scope } : {}) } as never)],
    ['create_automation', (o, scope) => executeCreateAutomation(o, { name: 'A', description: 'd', instructions: 'i', schedule, ...(scope ? { scope } : {}) })],
  ]
  for (const [name, call] of creates) {
    const scopeOf = async (o: OverlayToolsOptions, scope?: 'personal' | 'workspace') =>
      (await withItem(undefined, () => call(o, scope))).writes.find((write) => write.body && 'scope' in write.body)?.body?.scope
    assert.equal(await scopeOf(inRoom, 'personal'), 'workspace', `${name} in a shared room`)
    assert.equal(await scopeOf(alone), 'personal', `${name} defaults to Personal`)
    assert.equal(await scopeOf(alone, 'workspace'), 'workspace', `${name} honours an asked-for Workspace`)
  }
})

test('save_skill saves nothing from a shared room', async () => {
  const { executeSaveSkill } = await import('./skill-executes')
  const { result, writes } = await withItem(undefined, () => executeSaveSkill(inRoom, { name: 'S', description: 'd', instructions: 'i' } as never))
  assert.equal(result.success, false)
  assert.equal(writes.length, 0)
})

test('computer tools never reach a person’s own computer from a shared room', async () => {
  const { computerInstanceFor } = await import('./overlay-executes')
  for (const options of [inRoom, { ...inRoom, computerTarget: 'local' as const }, { ...inRoom, agentId: 'agent_1', computerTarget: 'local' as const }]) {
    const resolved = await computerInstanceFor(options as OverlayToolsOptions)
    assert.equal(resolved.ok, false)
    assert.match('error' in resolved ? String(resolved.error) : '', /own cloud computer/)
  }
})

test('a Personal item the person included on purpose is reachable by id in a shared room; others still are not', async () => {
  const included: OverlayToolsOptions = { ...inRoom, includedItemIds: ['note_mine'] }
  const original = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const id = new URL(String(input)).searchParams.get('noteId') ?? ''
    return Response.json({ _id: id, title: 'Plan', content: '# Plan', tags: [], scope: 'personal', createdAt: 1, updatedAt: 1 })
  }) as typeof fetch
  try {
    const mine = await executeGetNote(included, { noteId: 'note_mine' }) as { success: boolean }
    assert.equal(mine.success, true)
    const other = await executeGetNote(included, { noteId: 'note_other' }) as { success: boolean; error?: string }
    assert.deepEqual(other, { success: false, error: ROOM_PERSONAL_ITEM_ERROR })
  } finally {
    globalThis.fetch = original
  }
})
