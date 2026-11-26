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

test('an agent moves or archives only the kinds of item it may already change', async () => {
  const notesOnly = { ...alone, allowedToolIds: ['update_note', 'archive_item'] }
  const refused = await recording(() => executeArchiveItem(notesOnly, { resource: 'automation', id: 'a_1' }))
  assert.equal(refused.result.success, false)
  assert.equal(refused.seen.length, 0)
  const allowed = await recording(() => executeArchiveItem(notesOnly, { resource: 'file', id: 'n_1' }))
  assert.equal(allowed.result.success, true)
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
