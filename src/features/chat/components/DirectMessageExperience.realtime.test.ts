import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Convex room sends use one reconciliation transport', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  assert.match(source, /const convexRoomSubscriptionEnabled = convexLiveSyncEnabled/)
  assert.match(source, /appDataCapabilities\.provider === 'postgres'/)
  assert.doesNotMatch(source, /appDataCapabilities\.provider === 'convex' && !convexRoomSubscriptionEnabled/)
  assert.match(source, /if \(!convexRoomSubscriptionEnabled\) await loadMessages\(\)/)
  assert.doesNotMatch(source, /setNotice\('This conversation is unavailable\.'\)/)
  // Saving the message starts the agent turn server-side; this client neither
  // triggers it nor waits for it.
  assert.doesNotMatch(source, /agentReplyStreamResponse/)
  assert.doesNotMatch(source, /deferAgentReply/)
})

test('agent response activity keeps dots, omits duplicate copy, and follows streamed text', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  assert.match(source, /generatingMessages\.length === 0/)
  assert.doesNotMatch(source, /\$\{agentResponding\} is responding/)
  assert.match(source, /generatingTextLength/)
  assert.match(
    source,
    /\[agentResponding, conversationId, loading, messages\.length, generatingTextLength\]/,
  )
})

test('a streaming agent reply lives in the transcript, not in local component state', async () => {
  const source = await readFile(new URL('./DirectMessageExperience.tsx', import.meta.url), 'utf8')

  // A second copy of the reply held in React state is what made the stream die
  // on reload and kept every other participant from seeing it at all.
  assert.doesNotMatch(source, /streamingAgentReplies/)
  assert.match(source, /messages\.filter\(\(message\) => message\.status === 'generating'\)/)
  // The trigger request must not suppress remote reconciliation any more: the
  // events it would have masked are now the reply itself.
  assert.match(source, /hasActiveLocalStream: \(\) => false/)
})
