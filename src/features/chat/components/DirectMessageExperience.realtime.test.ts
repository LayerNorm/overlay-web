import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Convex room sends use one reconciliation transport', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  assert.match(source, /const convexRoomSubscriptionEnabled = convexLiveSyncEnabled/)
  assert.match(source, /appDataCapabilities\.provider === 'convex' && !convexRoomSubscriptionEnabled/)
  assert.match(source, /if \(!convexRoomSubscriptionEnabled\) await loadMessages\(\)/)
  assert.match(source, /const humanMessageId = saved\.messageId/)
  assert.doesNotMatch(source, /setNotice\('This conversation is unavailable\.'\)/)
})
