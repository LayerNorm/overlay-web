import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamTextMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn()
}))

vi.mock('./app-api-client', () => ({
  desktopAppJson: vi.fn(),
  desktopAppStreamText: streamTextMock
}))

import { streamCloudActMessage, type DesktopActStreamChunk } from './cloud-chat-service'

const request = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  modelId: 'model-1',
  messages: []
}

describe('streamCloudActMessage terminal events', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
  })

  it.each([
    ['finish event', 'data: {"type":"finish"}\n\n'],
    ['done sentinel', 'data: [DONE]\n\n']
  ])('settles immediately on a %s', async (_name, terminalChunk) => {
    let shouldContinue: boolean | void = true
    streamTextMock.mockImplementation(
      async (_path: string, _init: RequestInit, onChunk: (chunk: string) => boolean | void) => {
        shouldContinue = onChunk(terminalChunk)
      }
    )
    const chunks: DesktopActStreamChunk[] = []

    await streamCloudActMessage({
      ...request,
      onChunk: (chunk) => chunks.push(chunk)
    })

    expect(shouldContinue).toBe(false)
    expect(chunks).toEqual([{ type: 'done' }])
  })
})
