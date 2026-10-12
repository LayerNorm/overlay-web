import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from 'ai'
import { executeListFiles } from './files-executes'
import { executeListNotes } from './notes-executes'
import { executeListAutomations, executeListSkills, executeSearchKnowledge, executeSearchMemory, executeSearchMessages } from './overlay-executes'
import { roomListScope } from './room-scope'
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
