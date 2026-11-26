import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedOverlayToolIdsForTurn } from '@overlay/tools-core/exposure-policy'
import { normalizeAgentToolGrant } from '@/shared/agents/tool-groups'
import { executeGenerateImage } from './overlay-executes'
import { executeArchiveItem, executeMoveToWorkspace, executeRestoreItem, ROOM_MOVE_ERROR } from './scope-executes'
import { ownerNamesFor } from './owner-names'
import type { OverlayToolsOptions } from './types'

const alone: OverlayToolsOptions = { userId: 'user_1', workspaceId: 'ws_1', baseUrl: 'https://overlay.test' }
const inRoom: OverlayToolsOptions = { ...alone, sharedRoom: true }

type Seen = { url: URL; body: Record<string, unknown> | null }

async function recording(run: () => Promise<unknown>, reply: () => Response = () => Response.json({ success: true })) {
  const seen: Seen[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    seen.push({ url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null })
    return reply()
  }) as typeof fetch
  let result: unknown
  try { result = await run() } finally { globalThis.fetch = original }
  return { seen, result: result as { success: boolean; error?: string } }
}

test('move_to_workspace asks the scope API for a one-way move, taking an automation’s agent only when asked', async () => {
  const { seen, result } = await recording(() => executeMoveToWorkspace(alone, { resource: 'file', id: 'file_1' }))
  assert.equal(result.success, true)
  assert.equal(seen[0]?.url.pathname, '/api/v1/scope')
  assert.deepEqual(
    { resource: seen[0]?.body?.resource, id: seen[0]?.body?.id, action: seen[0]?.body?.action, to: seen[0]?.body?.to },
    { resource: 'files', id: 'file_1', action: 'move', to: 'workspace' },
  )
  assert.equal(seen[0]?.body?.workspaceItemsOnly, undefined)
  const automation = await recording(() => executeMoveToWorkspace(alone, { resource: 'automation', id: 'a_1', withAgent: true }))
  assert.equal(automation.seen[0]?.body?.withAgent, true)
  const file = await recording(() => executeMoveToWorkspace(alone, { resource: 'file', id: 'f', withAgent: true }))
  assert.equal(file.seen[0]?.body?.withAgent, undefined)
})

test('nothing moves to Workspace from a room others can read', async () => {
  const { seen, result } = await recording(() => executeMoveToWorkspace(inRoom, { resource: 'file', id: 'file_1' }))
  assert.deepEqual(result, { success: false, error: ROOM_MOVE_ERROR })
  assert.equal(seen.length, 0)
})

test('archive and restore in a shared room reach only Workspace items', async () => {
  for (const run of [
    (o: OverlayToolsOptions) => executeArchiveItem(o, { resource: 'task', id: 't_1' }),
    (o: OverlayToolsOptions) => executeRestoreItem(o, { resource: 'skill', id: 's_1' }),
  ]) {
    const shared = await recording(() => run(inRoom))
    assert.equal(shared.seen[0]?.body?.workspaceItemsOnly, true)
    const own = await recording(() => run(alone))
    assert.equal(own.seen[0]?.body?.workspaceItemsOnly, undefined)
  }
})

test('the scope API’s refusal is relayed as a plain message', async () => {
  const { result } = await recording(
    () => executeArchiveItem(inRoom, { resource: 'file', id: 'file_1' }),
    () => Response.json({ error: 'That item is Personal.' }, { status: 403 }),
  )
  assert.deepEqual(result, { success: false, error: 'That item is Personal.' })
})

test('the scope tools are offered only when the person asks to share, archive or restore', () => {
  const offered = (text: string) => allowedOverlayToolIdsForTurn({ latestUserText: text })
  assert.ok(offered('move my launch note to the workspace').includes('move_to_workspace'))
  assert.ok(offered('archive the old onboarding doc').includes('archive_item'))
  assert.ok(offered('restore that task').includes('restore_item'))
  assert.equal(offered('summarize my launch note').includes('move_to_workspace'), false)
})

test('agents saved with the files group keep it after the scope tools joined', () => {
  const grant = normalizeAgentToolGrant(['write_file', 'update_note'])
  for (const id of ['move_to_workspace', 'archive_item', 'restore_item']) assert.ok(grant.includes(id), id)
})

test('generated images go to Workspace in a shared room, and as asked elsewhere', async () => {
  const reply = () => Response.json({ outputId: 'o_1', modelUsed: 'm' })
  const shared = await recording(() => executeGenerateImage(inRoom, { prompt: 'a cat', scope: 'personal' }), reply)
  assert.equal(shared.seen[0]?.body?.scope, 'workspace')
  const own = await recording(() => executeGenerateImage(alone, { prompt: 'a cat' }), reply)
  assert.equal(own.seen[0]?.body?.scope, 'personal')
  const asked = await recording(() => executeGenerateImage(alone, { prompt: 'a cat', scope: 'workspace' }), reply)
  assert.equal(asked.seen[0]?.body?.scope, 'workspace')
})

test('owner labels call the caller "you" without a lookup', async () => {
  const ownerOf = await ownerNamesFor(alone, ['user_1', null])
  assert.equal(ownerOf('user_1'), 'you')
  assert.equal(ownerOf(null), undefined)
})

test('the scope route keeps the workspace-context flag the tools send', async () => {
  const { ScopeActionRequest } = await import('@/shared/schemas/misc')
  const parsed = ScopeActionRequest.parse({ resource: 'files', id: 'f', action: 'archive', workspaceItemsOnly: true })
  assert.equal(parsed.workspaceItemsOnly, true)
})

test('an agent’s grant does not offer moving or archiving unless the person asks in this turn', async () => {
  const { withAgentGrantToolIds } = await import('@/server/app-api/v1/conversations/act/tooling')
  const grant = ['list_files', 'move_to_workspace', 'archive_item', 'restore_item']
  const quiet = withAgentGrantToolIds(allowedOverlayToolIdsForTurn({ latestUserText: 'summarize my notes' }), grant, true)
  for (const id of ['move_to_workspace', 'archive_item', 'restore_item']) assert.equal(quiet.includes(id), false, id)
  assert.ok(quiet.includes('list_files'))
  const asked = withAgentGrantToolIds(allowedOverlayToolIdsForTurn({ latestUserText: 'archive the old onboarding doc' }), grant, true)
  assert.ok(asked.includes('archive_item'))
})

test('outside apps never get the scope tools', async () => {
  const { MCP_EXTERNAL_WITHHELD_TOOL_IDS } = await import('@/shared/mcp/access')
  for (const id of ['move_to_workspace', 'archive_item', 'restore_item']) assert.ok(MCP_EXTERNAL_WITHHELD_TOOL_IDS.includes(id), id)
})

test('archived files can be listed to restore, and a room sees only archived Workspace ones', async () => {
  const { executeListFiles } = await import('./files-executes')
  const rows = [
    { _id: 'f_w', name: 'Plan', type: 'file', updatedAt: 1, scope: 'workspace', archivedAt: 1, userId: 'user_1' },
    { _id: 'f_p', name: 'Diary', type: 'file', updatedAt: 1, scope: 'personal', archivedAt: 1, userId: 'user_1' },
  ]
  const reply = () => Response.json({ data: rows, nextCursor: null, hasMore: false })
  const own = await recording(() => executeListFiles(alone, { archived: true }), reply)
  assert.equal(own.seen[0]?.url.searchParams.get('view'), 'archived')
  assert.deepEqual((own.result as unknown as { files: Array<{ fileId: string }> }).files.map((f) => f.fileId), ['f_w', 'f_p'])
  const room = await recording(() => executeListFiles(inRoom, { archived: true }), reply)
  assert.deepEqual((room.result as unknown as { files: Array<{ fileId: string }> }).files.map((f) => f.fileId), ['f_w'])
})

test('a video the route refuses to start is reported as failed, not pending', async () => {
  const { executeGenerateVideo } = await import('./overlay-executes')
  const reply = () => new Response('data: {"type":"error","error":"save_failed","message":"Could not create the output record."}\n\n')
  const { result } = await recording(() => executeGenerateVideo(alone, { prompt: 'a cat' }), reply)
  assert.deepEqual(result, { success: false, status: 'failed', error: 'Could not create the output record.' })
})

test('archived skills and automations can be listed to restore, and a room sees only archived Workspace ones', async () => {
  const { executeListSkills, executeListAutomations } = await import('./overlay-executes')
  const rows = [
    { _id: 'w', name: 'Shared', instructions: 'i', enabled: false, scope: 'workspace' },
    { _id: 'p', name: 'Mine', instructions: 'i', enabled: true, scope: 'personal' },
  ]
  const reply = () => Response.json(rows)
  for (const [run, key] of [[executeListSkills, 'skills'], [executeListAutomations, 'automations']] as const) {
    const own = await recording(() => run(alone, { archived: true }), reply)
    assert.equal(own.seen[0]?.url.searchParams.get('view'), 'archived')
    assert.deepEqual((own.result as unknown as Record<string, Array<{ _id: string }>>)[key].map((r) => r._id), ['w', 'p'], key)
    const room = await recording(() => run(inRoom, { archived: true }), reply)
    assert.deepEqual((room.result as unknown as Record<string, Array<{ _id: string }>>)[key].map((r) => r._id), ['w'], key)
  }
})
