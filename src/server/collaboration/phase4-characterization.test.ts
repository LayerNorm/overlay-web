import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import overlayAppConfig from '@/overlay.config'
import { AUTHORIZATION_ROUTE_POLICIES } from '@/server/authorization/authorization-route-policy'

const root = process.cwd()

test('Phase 4 enables channels while Agents remains gated for Phase 5', () => {
  const flags = new Map(overlayAppConfig.featureFlags?.map((feature) => [feature.id, feature.enabled]))
  assert.equal(flags.get('workspaces'), true)
  assert.equal(flags.get('collaborativeChats'), true)
  assert.equal(flags.get('channels'), true)
  assert.equal(flags.get('agents'), false)
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

test('Phase 4 migration carries channel shape, threads, reactions, pins, saves, and #general backfill', async () => {
  const migration = await readFile(`${root}/migrations/app-data/0034_channels_threads.sql`, 'utf8')
  for (const invariant of [
    'channel_slug',
    'channel_visibility',
    'thread_root_message_id',
    'conversation_message_reactions',
    'conversation_pins',
    'conversation_saved_messages',
    "'general'",
  ]) assert.match(migration, new RegExp(invariant))
})

test('Phase 4 ships create-channel, thread, reaction, pin, save, and workspace search UX', async () => {
  const [dialog, conversation, search] = await Promise.all([
    readFile(`${root}/src/features/chat/components/NewChannelDialog.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8'),
    readFile(`${root}/src/components/layout/GlobalSearchDialog.tsx`, 'utf8'),
  ])
  assert.match(dialog, /Create a channel/)
  assert.match(dialog, /Only invited members can open it/)
  assert.match(conversation, /Reply in thread/)
  assert.match(conversation, /Pin message/)
  assert.match(conversation, /Save message/)
  assert.match(search, /searchWorkspaceChats/)
})
