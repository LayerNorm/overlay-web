import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { textOnlySubscriptionPrompt } from './text-only-prompt'

test('file parts in every role become text notes and text parts are untouched', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'file', data: { type: 'data', data: new Uint8Array([1]) }, mediaType: 'application/pdf' },
    ] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'content', value: [
      { type: 'text', text: 'opened' },
      { type: 'file', data: { type: 'data', data: 'AQID' }, mediaType: 'image/jpeg' },
    ] } }] },
  ]
  const result = textOnlySubscriptionPrompt(prompt)
  assert.equal(result[0], prompt[0])
  assert.deepEqual(result[1]!.content, [
    { type: 'text', text: 'look' },
    { type: 'text', text: '[A file (application/pdf) was omitted: this model connection accepts text only, so you cannot see it. Tell the person if you need its contents.]' },
  ])
  assert.equal(result[2]!.content[0], prompt[2]!.content[0])
  const toolOutput = (result[3]!.content[0] as { output: { value: Array<{ type: string; text?: string }> } }).output.value
  assert.deepEqual(toolOutput.map(item => item.type), ['text', 'text'])
  assert.match(toolOutput[1]!.text!, /^\[An image \(image\/jpeg\) was omitted/)
})

test('a text-only prompt is returned with the same parts', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'text', value: 'ok' } }] },
  ]
  const result = textOnlySubscriptionPrompt(prompt)
  assert.equal(result[0]!.content[0], prompt[0]!.content[0])
  assert.equal(result[1]!.content[0], prompt[1]!.content[0])
})
