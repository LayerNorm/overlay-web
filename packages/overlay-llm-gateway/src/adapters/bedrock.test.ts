import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { generateText, type LanguageModel as AISDKLanguageModel } from 'ai'
import { BedrockGateway } from './bedrock'

const awsEnvNames = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const
const originalAwsEnv = new Map(awsEnvNames.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of awsEnvNames) restoreEnv(name, originalAwsEnv.get(name))
})

test('Bedrock maps catalog model IDs and lists configured IDs', async () => {
  const gateway = new BedrockGateway({
    region: 'us-east-1',
    modelIds: {
      'openai/gpt-5.4-mini': 'us.anthropic.claude-sonnet-4-6-v1:0',
      'tenant/custom-model': 'amazon.titan-text-express-v1',
    },
  })

  const mapped = await gateway.createLanguageModel('openai/gpt-5.4-mini')
  const models = await gateway.listModels()

  assert.equal((mapped.implementation as { modelId: string }).modelId, 'us.anthropic.claude-sonnet-4-6-v1:0')
  assert.deepEqual(models.map(({ id, provider }) => ({ id, provider })), [
    { id: 'openai/gpt-5.4-mini', provider: 'openai' },
    { id: 'tenant/custom-model', provider: 'bedrock' },
  ])
})

test('Bedrock rejects unmapped catalog models and passes native IDs through', async () => {
  const gateway = new BedrockGateway({ region: 'us-east-1' })

  await assert.rejects(
    gateway.createLanguageModel('openai/gpt-5.4-mini'),
    /No Bedrock model ID is mapped for openai\/gpt-5\.4-mini\. Set llm\.bedrock\.modelIds \(BEDROCK_MODEL_IDS\)\./,
  )

  const native = await gateway.createLanguageModel('arn:aws:bedrock:us-east-1:123456789012:inference-profile/example')
  assert.equal(
    (native.implementation as { modelId: string }).modelId,
    'arn:aws:bedrock:us-east-1:123456789012:inference-profile/example',
  )
})

test('Bedrock signs chat requests with the AWS environment credential chain', async () => {
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
  process.env.AWS_REGION = 'us-east-1'
  delete process.env.AWS_SESSION_TOKEN
  delete process.env.AWS_BEARER_TOKEN_BEDROCK

  let requestUrl = ''
  let authorization: string | null = null
  const gateway = new BedrockGateway({
    region: 'us-east-1',
    modelIds: { 'openai/gpt-5.4-mini': 'amazon.titan-text-express-v1' },
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requestUrl = request.url
      authorization = request.headers.get('authorization')
      return Response.json({ message: 'test response' }, { status: 400 })
    },
  })
  const model = await gateway.createLanguageModel('openai/gpt-5.4-mini')

  await assert.rejects(generateText({
    model: model.implementation as AISDKLanguageModel,
    prompt: 'test prompt',
    maxRetries: 0,
  }))

  assert.match(requestUrl, /^https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\//)
  assert.match(authorization ?? '', /^AWS4-HMAC-SHA256 /)
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
