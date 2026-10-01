import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import overlayAppConfig from '@/overlay.config'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'

const root = process.cwd()

test('Phase 4 channel guarantees remain enabled after Agents rolls forward', () => {
  const flags = new Map(overlayAppConfig.featureFlags?.map((feature) => [feature.id, feature.enabled]))
  assert.equal(flags.get('workspaces'), true)
  assert.equal(flags.get('collaborativeChats'), true)
  assert.equal(flags.get('channels'), true)
  assert.equal(flags.get('agents'), true)
})

test('Phase 4 protects channel search, reactions, pins, and saved-message routes', () => {
  const routes = new Map(AUTHORIZATION_ROUTE_POLICIES.map((rule) => [rule.path, rule]))
  for (const path of [
    '/api/v1/conversations/channels',
    '/api/v1/conversations/search',
    '/api/v1/conversations/saved-messages',
    '/api/v1/conversations/:conversationId/reactions',
    '/api/v1/conversations/:conversationId/pins',
  ]) assert.ok(routes.get(path), `missing ${path}`)
})

test('Phase 4 schema carries channel shape, threads, reactions, pins, saves, and #general backfill', async () => {
  // Convex is the only app-data provider (64b4257ae removed the Postgres
  // migrations this used to read), so the invariants live in the schema.
  const [schema, workspaces] = await Promise.all([
    readFile(`${root}/convex/schema.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/workspaces.ts`, 'utf8'),
  ])
  for (const invariant of [
    'channelSlug',
    'channelVisibility',
    'threadRootMessageId',
    'conversationMessageReactions: defineTable',
    'conversationPins: defineTable',
    'conversationSavedMessages: defineTable',
  ]) assert.match(schema, new RegExp(invariant))
  assert.match(workspaces, /channelSlug: 'general'/)
})

test('Phase 4 ships create-channel, thread, reaction, pin, save, and workspace search UX', async () => {
  const [dialog, conversation, message, search] = await Promise.all([
    readFile(`${root}/src/features/chat/components/NewChannelDialog.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.parts.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/collaboration/RoomMessageItem.tsx`, 'utf8'),
    readFile(`${root}/src/components/layout/GlobalSearchDialog.tsx`, 'utf8'),
  ])
  assert.match(dialog, /Create a channel/)
  assert.match(dialog, /Only invited members can open it/)
  assert.match(conversation, /threadRootMessageId/)
  assert.match(message, /Reply in thread/)
  assert.match(message, /Pin message/)
  assert.match(message, /Save message/)
  // Phase 7 moved the palette onto the permission-filtered workspace search
  // endpoint via searchMentions, which calls /api/v1/mention-search with the
  // active workspace header for workspace-scoped, permission-filtered results.
  assert.match(search, /searchMentions/)
})
