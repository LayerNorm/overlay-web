import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPersonalChatArchiveOptimisticUpdate,
  updatePersonalChatRow,
  updatePersonalChatUnread,
} from './personal-chat-optimistic'
import {
  nativeChatTitleForDisplay,
  persistNativeChatTitle,
} from '../../features/chat/lib/persist-native-chat-title'

type Row = {
  _id: string
  title: string
  lastModified: number
}

test('rejecting an older rename preserves newer intent and unrelated remote rows', () => {
  const initial: Row[] = [
    { _id: 'chat-a', title: 'Original', lastModified: 1 },
    { _id: 'chat-b', title: 'Other', lastModified: 2 },
  ]
  const olderOptimistic = updatePersonalChatRow(initial, 'chat-a', (row) => ({
    ...row,
    title: 'Older rename',
  }))
  const newerOptimistic = updatePersonalChatRow(olderOptimistic, 'chat-a', (row) => ({
    ...row,
    title: 'Newer rename',
  }))
  const serverStateAfterOlderFailure: Row[] = [
    { _id: 'chat-a', title: 'Original', lastModified: 1 },
    { _id: 'chat-b', title: 'Remote update', lastModified: 3 },
  ]
  const rebasedNewerIntent = updatePersonalChatRow(serverStateAfterOlderFailure, 'chat-a', (row) => ({
    ...row,
    title: newerOptimistic.find((candidate) => candidate._id === 'chat-a')!.title,
  }))

  assert.equal(rebasedNewerIntent.find((row) => row._id === 'chat-a')?.title, 'Newer rename')
  assert.deepEqual(rebasedNewerIntent.find((row) => row._id === 'chat-b'), {
    _id: 'chat-b',
    title: 'Remote update',
    lastModified: 3,
  })
})

test('archive and Undo prefer current store fields over a stale fallback snapshot', () => {
  const fallback = {
    _id: 'chat-a',
    workspaceId: 'workspace-a',
    title: 'Old title',
    unread: false,
    archivedAt: undefined as number | undefined,
  }
  let current: typeof fallback | undefined = {
    _id: 'chat-a',
    workspaceId: 'workspace-a',
    title: 'Remote rename',
    unread: true,
    archivedAt: 10,
  }
  const applyArchiveUpdate = createPersonalChatArchiveOptimisticUpdate(fallback, {
    getCurrent: () => current,
    move: (_args, row) => { current = row ?? undefined },
    updateSummary: (_args, next) => { current = next ?? undefined },
  })
  applyArchiveUpdate({
    workspaceId: 'workspace-a',
    conversationId: 'chat-a',
    archived: true,
  })
  assert.equal(current?.title, 'Remote rename')
  assert.equal(current?.unread, true)
  assert.ok(typeof current?.archivedAt === 'number')

  current = { ...current!, title: 'Newer remote title', unread: false }
  applyArchiveUpdate({
    workspaceId: 'workspace-a',
    conversationId: 'chat-a',
    archived: false,
  })
  assert.deepEqual(current, {
    ...fallback,
    title: 'Newer remote title',
    unread: false,
    archivedAt: undefined,
  })
})

test('mark-read optimistic update preserves unread when a newer message arrived', () => {
  const row = { _id: 'chat-a', unread: true, lastMessageId: 'new-message' }
  assert.equal(updatePersonalChatUnread(row, false, 'observed-message'), row)
  assert.deepEqual(updatePersonalChatUnread(row, false, 'new-message'), {
    ...row,
    unread: false,
  })
})

test('native title rejection does not invoke a local rollback path', async () => {
  assert.equal(nativeChatTitleForDisplay(true, 'Persisted title', 'Rejected local title'), 'Persisted title')
  assert.equal(nativeChatTitleForDisplay(true, undefined, 'Rejected local title'), null)
  assert.equal(nativeChatTitleForDisplay(false, undefined, 'Legacy title'), 'Legacy title')

  const calls: Array<[string, string]> = []
  const persisted = await persistNativeChatTitle(async (chatId, title) => {
    calls.push([chatId, title])
    throw new Error('permission denied')
  }, 'chat-a', 'New title')

  assert.equal(persisted, false)
  assert.deepEqual(calls, [['chat-a', 'New title']])
})

test('Undo does not reconstruct a record whose current summary is known missing', () => {
  const stale = { _id: 'deleted-chat', title: 'Deleted elsewhere', archivedAt: 1 }
  let moved: typeof stale | null | undefined = stale
  const apply = createPersonalChatArchiveOptimisticUpdate(stale, {
    getCurrent: () => null,
    move: (_args, row) => { moved = row },
    updateSummary: () => {},
  })
  apply({ workspaceId: 'workspace-a', conversationId: stale._id, archived: false })
  assert.equal(moved, null)
})

test('queued Undo preserves a remote rename after archive removes the only loaded list row', () => {
  const stale = { _id: 'chat-a', title: 'Original', unread: false, archivedAt: undefined as number | undefined }
  let active = [stale]
  let summary: typeof stale | null | undefined
  const effects = {
    getCurrent: () => summary === null ? null : summary ?? active[0],
    move: (_args: unknown, row: typeof stale | null) => { active = row && row.archivedAt === undefined ? [row] : [] },
    updateSummary: (_args: unknown, row: typeof stale | null) => { summary = row },
  }
  const archive = createPersonalChatArchiveOptimisticUpdate(stale, effects)
  const undo = createPersonalChatArchiveOptimisticUpdate(stale, effects)
  archive({ workspaceId: 'workspace-a', conversationId: stale._id, archived: true })
  // Convex replays pending operations on the new server base. The archived
  // list and detail query are not mounted; only the active list is loaded.
  active = [{ ...stale, title: 'Concurrent rename', unread: true }]
  summary = undefined
  archive({ workspaceId: 'workspace-a', conversationId: stale._id, archived: true })
  assert.equal(active.length, 0)
  undo({ workspaceId: 'workspace-a', conversationId: stale._id, archived: false })
  assert.deepEqual(active, [{ ...stale, title: 'Concurrent rename', unread: true }])
})
