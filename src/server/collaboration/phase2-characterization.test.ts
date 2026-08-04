import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { overlayAppShell } from '@/overlay.config'
import type {
  ConversationListRow,
  ConversationMessageRow,
} from '@/server/conversations/ActConversationRepository'

test('Phase 2 exposes Chats as five workspace-scoped views', () => {
  const chats = overlayAppShell.navigation.find((item) => item.id === 'chat')
  assert.equal(chats?.label, 'Chats')
  assert.deepEqual(
    chats?.subviews,
    ['personal', 'dms', 'channels', 'activity', 'all'],
  )
  assert.equal(
    overlayAppShell.featureFlags.find((flag) => flag.id === 'collaborativeChats')?.enabled,
    true,
  )
  assert.equal(
    overlayAppShell.featureFlags.find((flag) => flag.id === 'channels')?.enabled,
    true,
  )
})

test('Phase 2 conversation and message rows carry explicit scope and authorship', () => {
  const conversation: ConversationListRow = {
    _id: 'conversation_1',
    userId: 'user_1',
    workspaceId: 'workspace_1',
    conversationType: 'personal',
    createdByPrincipalId: 'principal_1',
    title: 'Preserved title',
    lastModified: 2,
    createdAt: 1,
    updatedAt: 2,
    lastMode: 'act',
    askModelIds: ['model_a'],
    actModelId: 'model_b',
    projectId: 'project_1',
    shareVisibility: 'public',
    shareToken: 'preserved-token',
  }
  const message: ConversationMessageRow = {
    _id: 'message_1',
    turnId: 'turn_1',
    role: 'user',
    authorKind: 'human',
    authorPrincipalId: conversation.createdByPrincipalId,
    mode: 'act',
    content: 'Preserved content',
    contentType: 'text',
    parts: [{ type: 'file', fileName: 'preserved.pdf' }],
    createdAt: 3,
  }
  assert.deepEqual(
    [conversation.workspaceId, conversation.conversationType, message.authorKind],
    ['workspace_1', 'personal', 'human'],
  )
  assert.equal(message.parts?.[0]?.fileName, 'preserved.pdf')
  assert.equal(conversation.shareToken, 'preserved-token')
})

test('Phase 2 Postgres migration preserves payload columns while adding bindings', async () => {
  const migration = await readFile(
    new URL('../../../migrations/app-data/0032_workspace_conversations.sql', import.meta.url),
    'utf8',
  )
  for (const invariant of [
    'workspace_id',
    'conversation_type',
    'created_by_principal_id',
    'author_kind',
    'author_principal_id',
    'workspace_resource_scopes',
  ]) {
    assert.match(migration, new RegExp(invariant))
  }
  for (const preservedColumn of [
    'title',
    'project_id',
    'ask_model_ids',
    'act_model_id',
    'share_token',
    'parts',
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`DROP COLUMN "${preservedColumn}"`, 'i'),
    )
  }
})
