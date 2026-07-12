import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import type { OverlayRuntimeConfig } from '@/shared/config'

import { createEmbeddingProvider, KNOWLEDGE_EMBEDDING_DIMENSIONS } from './EmbeddingProvider'

const originalFetch = globalThis.fetch
const originalGatewayKey = process.env.AI_GATEWAY_API_KEY
const originalOpenAiKey = process.env.OPENAI_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreEnv('AI_GATEWAY_API_KEY', originalGatewayKey)
  restoreEnv('OPENAI_API_KEY', originalOpenAiKey)
})

test('AI Gateway embedding requests require zero-data-retention routing', async () => {
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
  const requestBodies: unknown[] = []
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)))
    return embeddingResponse()
  }

  const provider = createEmbeddingProvider(configFor('ai-gateway'))
  await provider.embed(['confidential enterprise context'])

  assert.deepEqual(requestBodies, [{
    input: 'confidential enterprise context',
    model: 'openai/text-embedding-3-small',
    providerOptions: { gateway: { zeroDataRetention: true } },
  }])
})

test('direct OpenAI embedding requests omit AI Gateway provider options', async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key'
  const requestBodies: unknown[] = []
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)))
    return embeddingResponse()
  }

  const provider = createEmbeddingProvider(configFor('openai'))
  await provider.embed(['direct provider context'])

  assert.deepEqual(requestBodies, [{
    input: 'direct provider context',
    model: 'text-embedding-3-small',
  }])
})

function configFor(provider: 'ai-gateway' | 'openai'): OverlayRuntimeConfig {
  return {
    providers: {
      embeddings: { provider },
    },
  } as OverlayRuntimeConfig
}

function embeddingResponse(): Response {
  return Response.json({
    data: [{
      embedding: Array.from({ length: KNOWLEDGE_EMBEDDING_DIMENSIONS }, () => 0),
      index: 0,
    }],
  })
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
