import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = process.cwd()

test('Convex collaboration realtime does not mount the BFF event poll', async () => {
  const [inlinePanel, room, provider] = await Promise.all([
    readFile(`${root}/src/features/chat/components/ChatInlinePanel.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/DirectMessageExperience.tsx`, 'utf8'),
    readFile(`${root}/src/features/chat/components/collaboration/CollaborationRealtimeProvider.tsx`, 'utf8'),
  ])
  assert.match(inlinePanel, /appDataCapabilities\.provider !== 'postgres'/)
  assert.match(room, /appDataCapabilities\.provider === 'postgres'/)
  assert.doesNotMatch(room, /provider === 'convex' && !convexRoomSubscriptionEnabled/)
  assert.match(provider, /watchConversationListVersion/)
  assert.match(provider, /watchNotifications/)
  assert.match(provider, /document\.visibilityState === 'visible'/)
})

test('dominant Convex maintenance and listing paths stay indexed and bounded', async () => {
  const [conversations, files, daytona] = await Promise.all([
    readFile(`${root}/convex/chat/conversations.ts`, 'utf8'),
    readFile(`${root}/convex/files/files.ts`, 'utf8'),
    readFile(`${root}/convex/ai/sandbox/daytonaReconcile.ts`, 'utf8'),
  ])
  const emptyCleanup = conversations.slice(conversations.indexOf('export const runEmptyConversationCleanup'))
  assert.match(emptyCleanup, /withIndex\('by_createdAt'/)
  assert.match(emptyCleanup, /\.paginate\(\{ cursor:/)
  assert.doesNotMatch(emptyCleanup.split('export const watchGeneratingMessages')[0] ?? '', /conversations'\)\.collect\(\)/)

  const fileList = files.slice(files.indexOf('export const list = query'))
  assert.match(fileList, /export const listPage = query/)
  assert.match(fileList, /\.paginate\(\{/)
  assert.doesNotMatch(fileList.split('export const get = query')[0] ?? '', /\.collect\(\)/)

  assert.match(daytona, /getReconciliationPlanInternal/)
  assert.match(daytona, /if \(!plan\.shouldRun\) return summary/)
  assert.match(daytona, /workspaceNeedsSync/)
})
