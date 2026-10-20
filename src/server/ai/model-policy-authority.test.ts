import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCatalogEntitlements, resolveRuntimeChatAllowlist } from './model-policy-authority'

test('discoverable paid models remain unauthorized for free users', () => {
  const catalog = {
    chat: new Set(['openrouter/free', 'moonshotai/kimi-k2.5']),
    image: new Set(['openai/gpt-image-1.5']),
    video: new Set(['google/veo-3.1-generate-001']),
  }
  for (const entitlements of [{ tier: 'free', planKind: 'free' } as const, null]) {
    const authorized = applyCatalogEntitlements(catalog, entitlements)
    assert.deepEqual([...authorized.chat], ['openrouter/free'])
    assert.equal(authorized.image.size, 0)
    assert.equal(authorized.video.size, 0)
  }
  assert.equal(catalog.chat.has('moonshotai/kimi-k2.5'), true)
  assert.equal(catalog.image.size, 1)
  assert.equal(catalog.video.size, 1)
})

test('paid authorization preserves catalog policy restrictions', () => {
  const catalog = {
    chat: new Set(['moonshotai/kimi-k2.5']),
    image: new Set<string>(),
    video: new Set(['google/veo-3.1-generate-001']),
  }
  const authorized = applyCatalogEntitlements(catalog, { tier: 'free', planKind: 'paid' })
  assert.deepEqual(authorized, catalog)
  assert.equal(authorized.chat.has('gpt-5.4'), false)
})

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
