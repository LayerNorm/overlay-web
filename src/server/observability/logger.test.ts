import assert from 'node:assert/strict'
import test from 'node:test'
import { logger } from './logger'

test('logger redacts user content and error messages before emitting structured logs', () => {
  const originalConsoleError = console.error
  let output = ''
  console.error = (value: unknown) => {
    output = String(value)
  }

  try {
    logger.error('request failed', {
      email: 'person@example.com',
      prompt: 'private instruction',
      provider: 'stripe',
    }, 'unclassified user text')
  } finally {
    console.error = originalConsoleError
  }

  const payload = JSON.parse(output) as { context: unknown }
  assert.deepEqual(payload.context, [{
    email: '[REDACTED]',
    prompt: '[REDACTED]',
    provider: 'stripe',
  }, '[REDACTED]'])
  assert.doesNotMatch(output, /person@example\.com|private instruction|unclassified user text/)
})
