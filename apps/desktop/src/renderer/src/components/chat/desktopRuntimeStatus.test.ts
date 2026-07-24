import { describe, expect, it } from 'vitest'
import {
  deriveDesktopProviderResponseStatus,
  isDesktopComposerStreaming,
  settleDesktopMessagesAsInterrupted
} from './desktopRuntimeStatus'
import type { Message, ProviderResponse } from './types'

function response(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return {
    modelId: 'model-1',
    modelName: 'Model 1',
    provider: 'test',
    content: '',
    isLoading: true,
    renderParts: [],
    ...overrides
  }
}

describe('desktop runtime status mapping', () => {
  it('covers submitted, text streaming, tool execution, completion, error, and interruption', () => {
    expect(deriveDesktopProviderResponseStatus(response())).toBe('submitted')
    expect(deriveDesktopProviderResponseStatus(response({ content: 'Partial' }))).toBe('streaming')
    expect(deriveDesktopProviderResponseStatus(response({
      renderParts: [{
        type: 'tool',
        id: 'tool-1',
        toolCallId: 'tool-1',
        toolName: 'search',
        state: 'input-available'
      }]
    }))).toBe('executing-tool')
    expect(deriveDesktopProviderResponseStatus(response({ isLoading: false, content: 'Done' }))).toBe('completed')
    expect(deriveDesktopProviderResponseStatus(response({ isLoading: false, error: 'Failed' }))).toBe('error')
    expect(deriveDesktopProviderResponseStatus(response(), { interrupted: true })).toBe('interrupted')
  })

  it('settles active responses once without changing completed responses', () => {
    const messages: Message[] = [{
      id: 'assistant-1',
      turnId: 'turn-1',
      role: 'assistant',
      content: 'Partial',
      timestamp: 1,
      responses: [response({ content: 'Partial' }), response({ modelId: 'model-2', isLoading: false, content: 'Done' })]
    }]
    const settled = settleDesktopMessagesAsInterrupted(messages)
    expect(settled[0]!.status).toBe('interrupted')
    expect(settled[0]!.responses?.[0]).toMatchObject({ isLoading: false, status: 'interrupted' })
    expect(settled[0]!.responses?.[1]).toMatchObject({ isLoading: false, content: 'Done' })
    expect(settleDesktopMessagesAsInterrupted(settled)).toBe(settled)
  })

  it.each([
    ['before first token', response()],
    ['during text', response({ content: 'Partial' })],
    ['during tool execution', response({
      renderParts: [{
        type: 'tool',
        id: 'tool-1',
        toolCallId: 'tool-1',
        toolName: 'search',
        state: 'input-available'
      }]
    })]
  ])('settles stop %s', (_label, activeResponse) => {
    const settled = settleDesktopMessagesAsInterrupted([{
      id: 'assistant-stop',
      role: 'assistant',
      content: activeResponse.content,
      timestamp: 1,
      responses: [activeResponse]
    }])
    expect(settled[0]!.responses?.[0]).toMatchObject({
      isLoading: false,
      status: 'interrupted'
    })
  })

  it('returns the composer to Send after the terminal response update', () => {
    const active: Message[] = [
      {
        id: 'assistant-active',
        role: 'assistant',
        content: 'Done',
        timestamp: 1,
        responses: [response({ content: 'Done' })]
      }
    ]
    const completed: Message[] = [
      {
        ...active[0]!,
        responses: [response({ content: 'Done', isLoading: false, status: 'completed' })]
      }
    ]

    expect(isDesktopComposerStreaming(active)).toBe(true)
    expect(isDesktopComposerStreaming(completed)).toBe(false)
    expect(isDesktopComposerStreaming([])).toBe(false)
    expect(isDesktopComposerStreaming(completed, true)).toBe(true)
  })
})
