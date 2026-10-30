import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTitleRequest } from './title-request'

test('the title hold covers complete multibyte prompts and instructions', () => {
  const text = '東京の旅行計画'.repeat(180)
  const instructions = 'Return a concise title only.'
  const request = buildTitleRequest(text, instructions)
  assert.ok(request.estimatedInputTokens >= Buffer.byteLength(request.prompt + instructions, 'utf8'))
  assert.ok(request.estimatedInputTokens > Math.ceil(1200 / 4) + 80,
    'the former character heuristic is not an admission ceiling for non-Latin text')
  const longerInstructions = buildTitleRequest(text, instructions.repeat(20))
  assert.ok(longerInstructions.estimatedInputTokens > request.estimatedInputTokens)
})

test('large source messages do not inflate title prompt or reservation beyond the bounded prefix', () => {
  const prefix = 'a'.repeat(1200)
  assert.deepEqual(buildTitleRequest(prefix + 'ignored'.repeat(20000), 'title only'),
    buildTitleRequest(prefix, 'title only'))
})
