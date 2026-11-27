import { describe, expect, it } from 'vitest'
import { applyAskChunkToMessage } from '../src/background/runtime'
import {
  consumeUiMessageEventStream,
  parseSseBlock,
} from '../src/background/overlay-api'
import type { ConversationMessage, MessageTextPart, MessageToolPart } from '@overlay/extension-contracts'
import { ASK_SSE_FIXTURE } from './fixtures/ask-stream'

function makeEmptyAssistant(): ConversationMessage {
  return {
    id: 'm1',
    role: 'assistant',
    turnId: 't-0',
    variantIndex: 0,
    parts: [],
    createdAt: 0,
  }
}

function fixtureToStream(raw: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = raw.match(/.{1,29}/gs) ?? []
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i]!))
      i += 1
    },
  })
}

describe('parseSseBlock', () => {
  it('returns null on [DONE]', () => {
    expect(parseSseBlock('data: [DONE]')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parseSseBlock('data: {not-json')).toBeNull()
  })

  it('parses a well-formed data block', () => {
    const block = `data: ${JSON.stringify({ type: 'text-delta', id: 'p1', delta: 'hi' })}`
    expect(parseSseBlock(block)).toEqual({ type: 'text-delta', id: 'p1', delta: 'hi' })
  })

  it('joins multi-line data fields', () => {
    const block = ['data: {', 'data: "type":"ping"', 'data: }'].join('\n')
    expect(parseSseBlock(block)).toEqual({ type: 'ping' })
  })
})

/** UI message SSE replay (shared by legacy remote ask and local act final-say streams). */
describe('Act / UI message stream replay', () => {
  it('reconstructs the final assistant message from the canonical fixture', async () => {
    const stream = fixtureToStream(ASK_SSE_FIXTURE)
    let message = makeEmptyAssistant()

    await consumeUiMessageEventStream(stream, (chunk) => {
      message = applyAskChunkToMessage(message, chunk as unknown as Record<string, unknown>)
    })

    const textPart = message.parts.find((p) => p.type === 'text') as MessageTextPart | undefined
    expect(textPart).toBeDefined()
    expect(textPart?.text).toBe('Hello, world!')

    const toolPart = message.parts.find((p) => p.type === 'tool') as MessageToolPart | undefined
    expect(toolPart).toBeDefined()
    expect(toolPart?.toolName).toBe('readCurrentPage')
    expect(toolPart?.state).toBe('output-available')
    expect(toolPart?.input).toEqual({ selector: 'body' })
    expect(toolPart?.output).toEqual({ text: 'ok' })

    expect(message.metadata?.modelId).toBe('gpt-5')
    expect(message.metadata?.finishReason).toBe('stop')
  })

  it('is order-invariant across chunk boundary splits', async () => {
    // Split every 1 byte to stress the buffer re-assembly logic.
    const encoder = new TextEncoder()
    const bytes = encoder.encode(ASK_SSE_FIXTURE)
    let i = 0
    const byteStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(i, i + 1))
        i += 1
      },
    })

    let message = makeEmptyAssistant()
    await consumeUiMessageEventStream(byteStream, (chunk) => {
      message = applyAskChunkToMessage(message, chunk as unknown as Record<string, unknown>)
    })

    const textPart = message.parts.find((p) => p.type === 'text') as MessageTextPart | undefined
    expect(textPart?.text).toBe('Hello, world!')
  })
})
