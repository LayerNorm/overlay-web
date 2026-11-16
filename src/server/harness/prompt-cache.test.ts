import { expect, test } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { StepResult, ToolSet } from 'ai'
import {
  applyHarnessPromptCache, harnessStateMessage, isHarnessStateMessage, stickyGatewayUpstream,
  usesExplicitPromptCache, withoutHarnessStateMessages,
} from './prompt-cache'

const tool = (name: string) => ({ type: 'function' as const, name, inputSchema: { type: 'object' as const } })

function call(): LanguageModelV4CallOptions {
  return {
    prompt: [
      { role: 'system', content: 'fixed instructions' },
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
      harnessStateMessage('state for step 2'),
    ] as LanguageModelV4CallOptions['prompt'],
    tools: [tool('a'), tool('b')],
    maxOutputTokens: 100,
  }
}

const marked = (entry: { providerOptions?: unknown }) =>
  (entry.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic?.cacheControl !== undefined

test('Anthropic calls mark the last tool, the system prompt and the last message before the state', () => {
  const options = applyHarnessPromptCache('anthropic/claude-sonnet-5.5', call())
  expect(options.prompt.map(marked)).toEqual([true, false, true, false])
  expect(options.tools!.map(marked)).toEqual([false, true])
})

test('the state flag never reaches a provider and markers do not accumulate', () => {
  const once = applyHarnessPromptCache('anthropic/claude-haiku-5.5', call())
  const twice = applyHarnessPromptCache('anthropic/claude-haiku-5.5', once)
  expect(JSON.stringify(once.prompt)).not.toContain('harnessWorkingState')
  expect(twice.prompt.filter(marked)).toHaveLength(2)
  expect(twice.tools!.filter(marked)).toHaveLength(1)
})

test('implicit-cache providers get no markers', () => {
  for (const modelId of ['openai/gpt-6-luna', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4-pro']) {
    const options = applyHarnessPromptCache(modelId, call())
    expect([...options.prompt, ...options.tools!].some(marked)).toBe(false)
    expect(JSON.stringify(options.prompt)).not.toContain('harnessWorkingState')
  }
  expect(usesExplicitPromptCache('byok/anthropic/claude-opus-5.5')).toBe(true)
})

test('only the newest state message is kept', () => {
  const messages = [
    { role: 'user' as const, content: 'question' },
    harnessStateMessage('old state'),
    { role: 'assistant' as const, content: 'answer' },
  ]
  expect(withoutHarnessStateMessages(messages)).toEqual([messages[0], messages[2]])
  // A person cannot forge the flag through message text.
  expect(isHarnessStateMessage({ role: 'user', providerOptions: undefined })).toBe(false)
})

test('a run sticks to the Gateway upstream that served most of its steps', () => {
  const step = (finalProvider: string, modelId = 'deepseek/deepseek-v4-pro') => ({
    model: { provider: 'overlay-harness', modelId },
    providerMetadata: { gateway: { routing: { finalProvider } } },
  }) as unknown as StepResult<ToolSet>
  // A one-off failover does not move the run to a cold cache.
  expect(stickyGatewayUpstream('deepseek/deepseek-v4-pro', [step('baseten'), step('fireworks'), step('baseten')])).toBe('baseten')
  expect(stickyGatewayUpstream('deepseek/deepseek-v4-pro', [step('baseten'), step('fireworks')])).toBe('baseten')
  expect(stickyGatewayUpstream('deepseek/deepseek-v4-pro', [])).toBeUndefined()
  expect(stickyGatewayUpstream('deepseek/deepseek-v4-pro', [step('baseten'), step('vertex', 'google/gemini-3.8-flash')])).toBe('baseten')
  expect(stickyGatewayUpstream('byok/deepseek/deepseek-v4-pro', [step('baseten')])).toBeUndefined()
  expect(stickyGatewayUpstream('deepseek/deepseek-v4-pro', [step('bad provider!')])).toBeUndefined()
})
