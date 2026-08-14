import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import overlayAppConfig from '@/overlay.config'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'

const root = process.cwd()

test('Phase 3 participant-scoped DMs remain enabled after Channels rolls forward', () => {
  const flags = new Map(overlayAppConfig.featureFlags?.map((feature) => [feature.id, feature.enabled]))
  assert.equal(flags.get('workspaces'), true)
  assert.equal(flags.get('collaborativeChats'), true)
  assert.equal(flags.get('channels'), true)
  assert.equal(flags.get('agents'), true)
})

test('Phase 3 route policies protect every DM resource boundary', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  assert.equal(routes.get('/api/v1/conversations/direct-messages')?.methods.POST?.access, 'capability')
  for (const path of [
    '/api/v1/conversations/:conversationId/participants',
    '/api/v1/conversations/:conversationId/state',
    '/api/v1/conversations/:conversationId/presence',
    '/api/v1/conversations/:conversationId/messages/:messageId',
  ]) {
    assert.ok(routes.get(path), `missing ${path}`)
  }
})

test('Phase 3 persists participant state, retries, tombstones, presence, and notifications', async () => {
  const migration = await readFile(`${root}/migrations/app-data/0033_direct_messages.sql`, 'utf8')
  for (const invariant of [
    'conversation_participants',
    'client_nonce',
    'deleted_at',
    'workspace_presence',
    'workspace_notifications',
    'notification_level',
    'marked_unread_at',
  ]) {
    assert.match(migration, new RegExp(invariant))
  }
})

test('Phase 3 exposes Personal-to-DM forking and a dedicated collaborative surface', async () => {
  // Rooms render through the shared chat transcript components, so the message
  // affordances live in the room message renderer rather than the screen.
  const [personal, direct, message] = await Promise.all([
    readFile(`${root}/src/features/chat/components/ChatExperience.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/collaboration/RoomMessageItem.tsx`, 'utf8'),
  ])
  assert.match(personal, /PersonalMentionConversionPrompt/)
  assert.match(direct, /use @ to notify someone/)
  assert.match(message, /Failed to send · Retry/)
  assert.match(message, /Message deleted/)
})

test('agent chats immediately publish their DM into the sidebar list', async () => {
  const [directory, convexDirectMessages, postgresDirectMessages] = await Promise.all([
    readFile(`${root}/src/features/agents/components/AgentsDirectory.tsx`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/PostgresConversationCollaborationRepository.ts`, 'utf8'),
  ])

  assert.match(directory, /createDirectMessage/)
  assert.match(directory, /dispatchChatCreated/)
  assert.match(directory, /conversationType: 'dm'/)
  assert.match(convexDirectMessages, /actorParticipant\?\.archivedAt/)
  assert.match(convexDirectMessages, /unarchived: true/)
  assert.match(postgresDirectMessages, /isNotNull\(conversationParticipants\.archivedAt\)/)
  assert.match(postgresDirectMessages, /type: 'conversation\.updated'/)
})
