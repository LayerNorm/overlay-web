import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Convex room sends use one reconciliation transport', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  assert.match(source, /const convexRoomSubscriptionEnabled = convexLiveSyncEnabled/)
  assert.match(source, /appDataCapabilities\.provider === 'postgres'/)
  assert.doesNotMatch(source, /appDataCapabilities\.provider === 'convex' && !convexRoomSubscriptionEnabled/)
  assert.match(source, /if \(!convexRoomSubscriptionEnabled\) await loadMessages\(\)/)
  assert.match(source, /const humanMessageId = saved\.messageId/)
  assert.doesNotMatch(source, /setNotice\('This conversation is unavailable\.'\)/)
})

test('agent response activity keeps dots, omits duplicate copy, and follows streamed text', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  assert.match(source, /mainStreamingReplies\.length === 0/)
  assert.doesNotMatch(source, /\$\{agentResponding\} is responding/)
  assert.match(source, /streamingAgentTextLength/)
  assert.match(
    source,
    /\[agentResponding, conversationId, loading, messages\.length, streamingAgentTextLength\]/,
  )
})
