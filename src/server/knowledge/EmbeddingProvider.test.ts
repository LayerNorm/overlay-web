import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import type { OverlayRuntimeConfig } from '@/shared/config'

import { createEmbeddingProvider, KNOWLEDGE_EMBEDDING_DIMENSIONS } from './EmbeddingProvider'

const originalFetch = globalThis.fetch
const envNames = [
  'AI_GATEWAY_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_RESOURCE_NAME',
  'AZURE_OPENAI_BASE_URL',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
  'BEDROCK_REGION',
  'BEDROCK_EMBEDDING_MODEL_ID',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const
const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]))

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const name of envNames) restoreEnv(name, originalEnv.get(name))
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

test('Azure OpenAI embeddings use the configured resource, deployment, and API key', async () => {
  process.env.AZURE_OPENAI_API_KEY = 'test-azure-key'
  process.env.AZURE_OPENAI_RESOURCE_NAME = 'overlay-east'
  process.env.AZURE_OPENAI_API_VERSION = '2025-04-01-preview'
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'embedding-small'
  let requestUrl = ''
  let requestModel = ''
  let apiKeyHeader: string | null = null
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requestUrl = request.url
    apiKeyHeader = request.headers.get('api-key')
    requestModel = JSON.parse(await request.clone().text()).model
    return embeddingResponse()
  }

  const provider = createEmbeddingProvider(configFor('azure-openai'))
  await provider.embed(['Azure embedding context'])

  assert.match(requestUrl, /^https:\/\/overlay-east\.openai\.azure\.com\/openai\/v1\/embeddings/)
  assert.equal(requestModel, 'embedding-small')
  assert.equal(apiKeyHeader, 'test-azure-key')
  assert.equal(provider.identity.modelId, 'embedding-small')
})

test('Bedrock embeddings use the region, model URL, and signed AWS credentials', async () => {
  process.env.BEDROCK_REGION = 'us-east-2'
  process.env.BEDROCK_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v1'
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
  delete process.env.AWS_SESSION_TOKEN
  delete process.env.AWS_BEARER_TOKEN_BEDROCK
  let requestUrl = ''
  let authorization: string | null = null
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requestUrl = request.url
    authorization = request.headers.get('authorization')
    return Response.json({
      embedding: Array.from({ length: KNOWLEDGE_EMBEDDING_DIMENSIONS }, () => 0),
      inputTextTokenCount: 3,
    })
  }

  const provider = createEmbeddingProvider(configFor('bedrock'))
  const vectors = await provider.embed(['Bedrock embedding context'])

  assert.equal(requestUrl, 'https://bedrock-runtime.us-east-2.amazonaws.com/model/amazon.titan-embed-text-v1/invoke')
  assert.match(authorization ?? '', /^AWS4-HMAC-SHA256 /)
  assert.equal(vectors[0]?.length, KNOWLEDGE_EMBEDDING_DIMENSIONS)
})

test('cloud embeddings reject vectors that do not match the knowledge index dimensions', async () => {
  process.env.BEDROCK_REGION = 'us-east-2'
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
  delete process.env.AWS_BEARER_TOKEN_BEDROCK
  globalThis.fetch = async () => Response.json({
    embedding: [0, 1, 2],
    inputTextTokenCount: 3,
  })

  await assert.rejects(
    createEmbeddingProvider(configFor('bedrock')).embed(['wrong dimension']),
    /Expected 1536 dims, got 3/,
  )
})

function configFor(provider: 'ai-gateway' | 'openai' | 'azure-openai' | 'bedrock'): OverlayRuntimeConfig {
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
