import assert from 'node:assert/strict'
import test from 'node:test'
import type { CodexTokenSet } from '@/server/agents/provider-accounts/codex-subscription'
import { CODEX_MODELS_URL, discoverCodexModels } from './codex-discovery'

const tokens: CodexTokenSet = {
  v: 1,
  idToken: 'id-token',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accountId: 'account-1',
  lastRefresh: 1,
}

test('Codex discovery is account-scoped, redirect-denied, and excludes hidden models', async () => {
  let requestedUrl = ''
  let requestedInit: RequestInit | undefined
  const models = await discoverCodexModels(tokens, {
    fetch: async (input, init) => {
      requestedUrl = String(input)
      requestedInit = init
      return Response.json({
        models: [
          { slug: 'codex-one', display_name: 'Codex One' },
          { slug: 'hidden-model', display_name: 'Hidden', is_hidden: true },
        ],
      })
    },
  })
  assert.equal(requestedUrl, CODEX_MODELS_URL)
  assert.equal(requestedInit?.redirect, 'error')
  assert.equal(new Headers(requestedInit?.headers).get('authorization'), 'Bearer access-token')
  assert.equal(new Headers(requestedInit?.headers).get('ChatGPT-Account-Id'), 'account-1')
  assert.deepEqual(models, [{ id: 'codex-one', name: 'Codex One' }])
})

test('discovery rejects empty catalogs and oversized bodies without a static fallback', async () => {
  await assert.rejects(
    discoverCodexModels(tokens, { fetch: async () => Response.json({ models: [] }) }),
    /no supported models/,
  )
  await assert.rejects(
    discoverCodexModels(tokens, {
      fetch: async () => new Response(new Uint8Array(1_000_001)),
    }),
    /response is too large/,
  )
})
