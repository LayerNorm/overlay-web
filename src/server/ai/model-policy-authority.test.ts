import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntimeChatAllowlist } from './model-policy-authority'

test('uses the validated runtime model allowlist when configuration is available', async () => {
  const allowlist = await resolveRuntimeChatAllowlist(async () => ({
    llm: { modelAllowlist: ['meta/muse-spark-1.1', 'openrouter/free'] },
  }) as never)

  assert.deepEqual([...allowlist!], ['meta/muse-spark-1.1', 'openrouter/free'])
})

test('preserves the direct environment allowlist when unrelated runtime validation fails', async () => {
  const allowlist = await resolveRuntimeChatAllowlist(
    async () => { throw new Error('Production Stripe billing requires a live key') },
    { LLM_MODEL_ALLOWLIST: ' meta/muse-spark-1.1, openrouter/free ' },
  )

  assert.deepEqual([...allowlist!], ['meta/muse-spark-1.1', 'openrouter/free'])
})

test('falls back to the live server catalog when no explicit allowlist exists', async () => {
  const allowlist = await resolveRuntimeChatAllowlist(
    async () => { throw new Error('runtime config unavailable') },
    {},
  )

  assert.equal(allowlist, null)
})
