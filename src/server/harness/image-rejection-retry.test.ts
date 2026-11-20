import { describe, expect, it, vi } from 'vitest'
import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from '@ai-sdk/provider'
import { retryWithoutToolImages, withoutToolResultImages } from './image-rejection-retry'

const image = { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'aGVsbG8=' } }
const prompt = [
  { role: 'system', content: 'You are an agent.' },
  { role: 'user', content: [{ type: 'text', text: 'Look at the page.' }, image] },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'computer_screenshot', input: {} }] },
  { role: 'tool', content: [
    { type: 'tool-result', toolCallId: 'c1', toolName: 'computer_screenshot',
      output: { type: 'content', value: [{ type: 'text', text: 'Screenshot captured.' }, image] } },
    { type: 'tool-result', toolCallId: 'c2', toolName: 'read', output: { type: 'text', value: 'plain' } },
  ] },
] as unknown as LanguageModelV4Prompt
const options = { prompt } as LanguageModelV4CallOptions
const rejection = (statusCode: number) => Object.assign(new Error('rejected'), { name: 'AI_APICallError', statusCode })

describe('retrying a rejected request without tool images', () => {
  it('replaces only images returned by tools and keeps the person\'s attachment', () => {
    const result = withoutToolResultImages(prompt)
    expect(result.removed).toBe(1)
    const text = JSON.stringify(result.prompt)
    expect(text).toContain('Screenshot captured.')
    expect(text).toContain('An image this tool returned was removed')
    expect((result.prompt[1] as { content: unknown[] }).content[1]).toBe(image)
    expect(JSON.stringify(result.prompt[3])).not.toContain('aGVsbG8=')
    expect(JSON.stringify(prompt[3])).toContain('aGVsbG8=')
  })

  it.each([400, 413])('sends the request once more without tool images after HTTP %i', async (status) => {
    const call = vi.fn()
      .mockRejectedValueOnce(rejection(status))
      .mockResolvedValueOnce('ok')
    const onRetry = vi.fn()
    await expect(retryWithoutToolImages(options, call, onRetry)).resolves.toBe('ok')
    expect(call).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(call.mock.calls[1]![0].prompt)).not.toContain('aGVsbG8=","')
    expect(JSON.stringify(call.mock.calls[1]![0].prompt[3])).not.toContain('aGVsbG8=')
    expect(onRetry).toHaveBeenCalledWith({ removed: 1, status })
  })

  it('does not retry other failures, or a request that has no tool images', async () => {
    const outage = vi.fn().mockRejectedValue(rejection(503))
    await expect(retryWithoutToolImages(options, outage)).rejects.toThrow('rejected')
    expect(outage).toHaveBeenCalledTimes(1)

    const textOnly = { prompt: prompt.slice(0, 2) } as LanguageModelV4CallOptions
    const invalid = vi.fn().mockRejectedValue(rejection(400))
    await expect(retryWithoutToolImages(textOnly, invalid)).rejects.toThrow('rejected')
    expect(invalid).toHaveBeenCalledTimes(1)
  })

  it('reports the second failure when the request is still refused', async () => {
    const call = vi.fn().mockRejectedValueOnce(rejection(400)).mockRejectedValueOnce(new Error('still refused'))
    await expect(retryWithoutToolImages(options, call)).rejects.toThrow('still refused')
    expect(call).toHaveBeenCalledTimes(2)
  })
})
