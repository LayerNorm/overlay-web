import type { GenerationResult, VideoSubMode } from '@overlay/chat-core'
import { overlayDesktopAppClient } from './app-api-client'

export type DesktopMediaKind = 'image' | 'video'

export interface DesktopMediaBatchParams {
  kind: DesktopMediaKind
  prompt: string
  modelIds: string[]
  conversationId: string
  turnId: string
  imageUrl?: string
  videoSubMode?: VideoSubMode
  signal?: AbortSignal
  onSlot?: (index: number, result: GenerationResult) => void
  cacheDataUrl?: (input: {
    chatId: string
    dataUrl: string
    name?: string
  }) => Promise<{ url: string }>
}

export async function runDesktopMediaGenerationBatch(
  params: DesktopMediaBatchParams
): Promise<GenerationResult[]> {
  const tasks = params.modelIds.map(async (modelId, index) => {
    let result: GenerationResult
    try {
      result =
        params.kind === 'image'
          ? await generateImage(params, modelId)
          : await generateVideo(params, modelId)
      if (result.status === 'completed' && result.url?.startsWith('data:') && params.cacheDataUrl) {
        const cached = await params.cacheDataUrl({
          chatId: params.conversationId,
          dataUrl: result.url,
          name: `${params.kind}-${index + 1}.${params.kind === 'image' ? 'png' : 'mp4'}`
        })
        result = { ...result, url: cached.url }
      }
    } catch (error) {
      result = {
        type: params.kind,
        status: 'failed',
        error:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Generation cancelled'
            : error instanceof Error
              ? error.message
              : String(error)
      }
    }
    params.onSlot?.(index, result)
    return result
  })
  return Promise.all(tasks)
}

async function generateImage(
  params: DesktopMediaBatchParams,
  modelId: string
): Promise<GenerationResult> {
  const response = await overlayDesktopAppClient.chat.generateImageResponse(
    {
      prompt: params.prompt,
      modelId,
      conversationId: params.conversationId,
      turnId: params.turnId,
      ...(params.imageUrl ? { imageUrl: params.imageUrl } : {})
    },
    { signal: params.signal }
  )
  if (!response.ok) return failedResult('image', response)
  const data = (await response.json()) as {
    url?: string
    modelUsed?: string
    outputId?: string | null
  }
  if (!data.url) return { type: 'image', status: 'failed', error: 'Image response was incomplete' }
  return {
    type: 'image',
    status: 'completed',
    url: data.url,
    modelUsed: data.modelUsed ?? modelId,
    outputId: data.outputId ?? undefined
  }
}

async function generateVideo(
  params: DesktopMediaBatchParams,
  modelId: string
): Promise<GenerationResult> {
  const response = await overlayDesktopAppClient.chat.generateVideoResponse(
    {
      prompt: params.prompt,
      modelId,
      conversationId: params.conversationId,
      turnId: params.turnId,
      videoSubMode: params.videoSubMode ?? 'text-to-video',
      ...(params.imageUrl ? { imageUrl: params.imageUrl } : {})
    },
    { signal: params.signal }
  )
  if (!response.ok) return failedResult('video', response)
  if (!response.body) return { type: 'video', status: 'failed', error: 'Video stream was missing' }

  const event = await readTerminalVideoEvent(response.body)
  if (event.type === 'completed' && event.url) {
    return {
      type: 'video',
      status: 'completed',
      url: event.url,
      modelUsed: event.modelUsed ?? modelId,
      outputId: event.outputId
    }
  }
  return {
    type: 'video',
    status: 'failed',
    outputId: event.outputId,
    error: event.error || 'Video generation ended without a result'
  }
}

async function failedResult(kind: DesktopMediaKind, response: Response): Promise<GenerationResult> {
  const text = await response.text().catch(() => '')
  let message = text || response.statusText || 'Generation failed'
  try {
    const json = JSON.parse(text) as { error?: string; message?: string }
    message = json.error || json.message || message
  } catch {
    // Preserve the plain-text response.
  }
  return {
    type: kind,
    status: 'failed',
    error: message,
    upgradeRequired: response.status === 402 || response.status === 403
  }
}

export interface VideoStreamEvent {
  type: string
  url?: string
  modelUsed?: string
  outputId?: string
  error?: string
}

export async function readTerminalVideoEvent(
  stream: ReadableStream<Uint8Array>
): Promise<VideoStreamEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let malformedEvents = 0

  const consume = (terminal = false): VideoStreamEvent | null => {
    const frames = buffer.split('\n\n')
    buffer = terminal ? '' : (frames.pop() ?? '')
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        const event = JSON.parse(data) as VideoStreamEvent
        if (event.type === 'completed' || event.type === 'failed') return event
      } catch {
        malformedEvents++
      }
    }
    return null
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const terminal = consume()
    if (terminal) return terminal
  }
  buffer += decoder.decode()
  if (buffer.trim()) buffer += '\n\n'
  const terminal = consume(true)
  if (terminal) return terminal
  return {
    type: 'failed',
    error: malformedEvents
      ? 'Video stream contained malformed data'
      : 'Video generation ended before completion'
  }
}

export async function restoreGenerationResultUrl(
  result: GenerationResult,
  options: { force?: boolean } = {}
): Promise<GenerationResult> {
  if (
    result.status !== 'completed' ||
    !result.outputId ||
    (!options.force && isUsableMediaUrl(result.url))
  )
    return result
  const response = await overlayDesktopAppClient.outputs.contentResponse(result.outputId)
  if (!response.ok) return result
  return { ...result, url: URL.createObjectURL(await response.blob()) }
}

export function isUsableMediaUrl(value: string | undefined): boolean {
  return Boolean(value && /^(https:|data:|blob:|overlay-media:)/.test(value))
}
