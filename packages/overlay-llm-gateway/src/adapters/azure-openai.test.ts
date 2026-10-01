import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { generateText, type LanguageModel as AISDKLanguageModel } from 'ai'
import { AzureOpenAIGateway } from './azure-openai'

const originalAzureApiKey = process.env.AZURE_OPENAI_API_KEY

afterEach(() => restoreEnv('AZURE_OPENAI_API_KEY', originalAzureApiKey))

test('Azure OpenAI uses a configured deployment and falls back to the OpenAI model ID', async () => {
  process.env.AZURE_OPENAI_API_KEY = 'test-azure-key'
  const gateway = new AzureOpenAIGateway({
    resourceName: 'overlay-east',
    deployments: { 'openai/gpt-5.4-mini': 'gpt-mini-deployment' },
  })

  const mapped = await gateway.createLanguageModel('openai/gpt-5.4-mini')
  const fallback = await gateway.createLanguageModel('openai/gpt-4.1')

  assert.equal((mapped.implementation as { modelId: string }).modelId, 'gpt-mini-deployment')
  assert.equal((fallback.implementation as { modelId: string }).modelId, 'gpt-4.1')
  assert.equal(mapped.provider, 'openai')
})

test('Azure OpenAI sends the resource URL, deployment model, and API key', async () => {
  let requestUrl = ''
  let requestBody: Record<string, unknown> = {}
  let apiKeyHeader: string | null = null
  const gateway = new AzureOpenAIGateway({
    apiKey: 'test-azure-key',
    resourceName: 'overlay-east',
    deployments: { 'openai/gpt-5.4-mini': 'gpt-mini-deployment' },
    fetch: async (input, init) => {
      requestUrl = input instanceof Request ? input.url : String(input)
      requestBody = JSON.parse(String(init?.body))
      apiKeyHeader = new Headers(init?.headers).get('api-key')
      return Response.json({ error: { message: 'test response' } }, { status: 400 })
    },
  })
  const model = await gateway.createLanguageModel('openai/gpt-5.4-mini')

  await assert.rejects(generateText({
    model: model.implementation as AISDKLanguageModel,
    prompt: 'test prompt',
    maxRetries: 0,
  }))

  assert.match(requestUrl, /^https:\/\/overlay-east\.openai\.azure\.com\/openai\/v1\//)
  assert.equal(requestBody.model, 'gpt-mini-deployment')
  assert.equal(apiKeyHeader, 'test-azure-key')
})

test('Azure OpenAI reports the missing API key environment variable', async () => {
  delete process.env.AZURE_OPENAI_API_KEY
  const gateway = new AzureOpenAIGateway({ resourceName: 'overlay-east' })

  await assert.rejects(
    gateway.createLanguageModel('openai/gpt-5.4-mini'),
    /AZURE_OPENAI_API_KEY/,
  )
})

test('Azure OpenAI lists configured deployments with catalog details when available', async () => {
  const gateway = new AzureOpenAIGateway({
    deployments: {
      'openai/gpt-5.4-mini': 'gpt-mini-deployment',
      'tenant/custom-model': 'custom-deployment',
    },
  })

  assert.deepEqual((await gateway.listModels()).map(({ id, name, provider }) => ({ id, name, provider })), [
    { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai' },
    { id: 'tenant/custom-model', name: 'tenant/custom-model', provider: 'openai' },
  ])
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
