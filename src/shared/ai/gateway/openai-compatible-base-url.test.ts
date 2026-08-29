import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AI_GATEWAY_BASE_URL,
  normalizeOpenAiCompatibleBaseUrl,
} from './openai-compatible-base-url'

test('normalizes AI Gateway endpoint URLs for OpenAI-compatible clients', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl(), DEFAULT_AI_GATEWAY_BASE_URL)
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ai-gateway.vercel.sh/v1/chat/completions'),
    DEFAULT_AI_GATEWAY_BASE_URL,
  )
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://gateway.example.test/v1/'),
    'https://gateway.example.test/v1',
  )
})
