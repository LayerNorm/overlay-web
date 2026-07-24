import { describe, expect, it, vi } from 'vitest'
import { readTerminalVideoEvent, runDesktopMediaGenerationBatch } from './desktop-media-generation'

function streamChunks(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    }
  })
}

describe('desktop video SSE parsing', () => {
  it('restores a completed event split across IPC chunks', async () => {
    const event = await readTerminalVideoEvent(
      streamChunks(
        'data: {"type":"started","outputId":"out_1"}\n\n',
        'data: {"type":"complet',
        'ed","outputId":"out_1","url":"https://cdn.example/video.mp4","modelUsed":"video-1"}\n\n'
      )
    )
    expect(event).toEqual({
      type: 'completed',
      outputId: 'out_1',
      url: 'https://cdn.example/video.mp4',
      modelUsed: 'video-1'
    })
  })

  it('surfaces failed, malformed, and incomplete terminal states', async () => {
    await expect(
      readTerminalVideoEvent(
        streamChunks('data: {"type":"failed","outputId":"out_2","error":"provider failed"}\n\n')
      )
    ).resolves.toMatchObject({ type: 'failed', error: 'provider failed' })
    await expect(readTerminalVideoEvent(streamChunks('data: {not-json}\n\n'))).resolves.toEqual({
      type: 'failed',
      error: 'Video stream contained malformed data'
    })
    await expect(
      readTerminalVideoEvent(streamChunks('data: {"type":"started"}\n\n'))
    ).resolves.toEqual({
      type: 'failed',
      error: 'Video generation ended before completion'
    })
  })
})

describe('desktop image generation', () => {
  it('uses the image API, preserves model order, and caches base64 results', async () => {
    const request = vi.fn(async (input: { body?: string | null }) => {
      const body = JSON.parse(input.body || '{}') as { modelId: string }
      const successful = body.modelId !== 'image-fail'
      return {
        ok: successful,
        status: successful ? 200 : 402,
        statusText: successful ? 'OK' : 'Payment Required',
        bodyText: successful
          ? JSON.stringify({
              url: `data:image/png;base64,${Buffer.from(body.modelId).toString('base64')}`,
              modelUsed: body.modelId,
              outputId: `output-${body.modelId}`
            })
          : JSON.stringify({ error: 'Upgrade required' }),
        headers: { 'content-type': 'application/json' }
      }
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        bridge: {
          appApi: { request, stream: vi.fn(), abort: vi.fn() }
        }
      }
    })
    const cached: string[] = []
    const results = await runDesktopMediaGenerationBatch({
      kind: 'image',
      prompt: 'A paper airplane',
      modelIds: ['image-a', 'image-fail', 'image-b'],
      conversationId: 'chat_1',
      turnId: 'turn_1',
      cacheDataUrl: async ({ dataUrl }) => {
        cached.push(dataUrl)
        return { url: `overlay-media://cache/chat_1/${cached.length}.png` }
      }
    })

    expect(request).toHaveBeenCalledTimes(3)
    expect(results.map((result) => result.modelUsed)).toEqual(['image-a', undefined, 'image-b'])
    expect(results[0].url).toContain('overlay-media:')
    expect(results[1]).toMatchObject({ status: 'failed', upgradeRequired: true })
    expect(cached).toHaveLength(2)
  })
})
