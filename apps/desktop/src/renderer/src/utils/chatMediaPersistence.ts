import type { GenerationResult } from '@overlay/chat-core'
import type {
  CachedMediaReference,
  Chat,
  DesktopGenerationState,
  Message,
  Screenshot
} from '../components/chat/types'

export const DESKTOP_GENERATION_DATA_TYPE = 'overlay.desktop-generation.v1'
export const DESKTOP_ATTACHMENTS_DATA_TYPE = 'overlay.desktop-attachments.v1'

export interface ChatMediaCacheBridge {
  cacheDataUrl(input: {
    chatId: string
    dataUrl: string
    name?: string
  }): Promise<CachedMediaReference>
}

export function generationStateForPersistence(
  state: DesktopGenerationState
): DesktopGenerationState {
  return {
    ...state,
    modelIds: [...state.modelIds],
    results: state.results.map((result) => ({
      ...result,
      url: isDurableGeneratedUrl(result.url) ? result.url : undefined
    }))
  }
}

export function parseDesktopGenerationState(value: unknown): DesktopGenerationState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<DesktopGenerationState>
  if (state.kind !== 'image' && state.kind !== 'video') return null
  if (!Array.isArray(state.modelIds) || !state.modelIds.every((id) => typeof id === 'string')) {
    return null
  }
  if (!Array.isArray(state.results)) return null
  const results = state.results.filter(isGenerationResult)
  if (results.length !== state.results.length) return null
  return {
    kind: state.kind,
    modelIds: [...state.modelIds],
    results,
    ...(isVideoSubMode(state.videoSubMode) ? { videoSubMode: state.videoSubMode } : {})
  }
}

export async function migrateLegacyChatMedia(
  chat: Chat,
  bridge: ChatMediaCacheBridge
): Promise<{ chat: Chat; changed: boolean; failures: number }> {
  let changed = false
  let failures = 0
  const messages: Message[] = []

  for (const message of chat.messages) {
    const screenshots: Screenshot[] = []
    for (const screenshot of message.screenshots ?? []) {
      if (screenshot.cachedMedia || !screenshot.dataUrl?.startsWith('data:')) {
        screenshots.push(screenshot)
        continue
      }
      try {
        const cachedMedia = await bridge.cacheDataUrl({
          chatId: chat.id,
          dataUrl: screenshot.dataUrl,
          name: screenshot.name
        })
        screenshots.push({ ...screenshot, dataUrl: undefined, cachedMedia })
        changed = true
      } catch {
        screenshots.push(screenshot)
        failures++
      }
    }

    let imageData = message.imageData
    if (
      imageData?.startsWith('data:') &&
      screenshots.some((screenshot) => screenshot.cachedMedia)
    ) {
      imageData = undefined
      changed = true
    }
    if (imageData?.startsWith('data:') && !screenshots.length) {
      try {
        const cachedMedia = await bridge.cacheDataUrl({
          chatId: chat.id,
          dataUrl: imageData,
          name: 'image.png'
        })
        screenshots.push({
          displayId: `${message.id}:legacy-image`,
          name: cachedMedia.name,
          loadStatus: 'loaded',
          cachedMedia
        })
        imageData = undefined
        changed = true
      } catch {
        failures++
      }
    }

    messages.push({
      ...message,
      imageData,
      ...(screenshots.length ? { screenshots } : { screenshots: message.screenshots })
    })
  }

  return { chat: changed ? { ...chat, messages } : chat, changed, failures }
}

export function screenshotUrl(screenshot: Screenshot): string {
  return screenshot.cachedMedia?.url || screenshot.dataUrl || ''
}

export function cachedAttachmentsForPersistence(message: Message): CachedMediaReference[] {
  return (message.screenshots ?? [])
    .map((screenshot) => screenshot.cachedMedia)
    .filter((media): media is CachedMediaReference => Boolean(media))
    .map((media) => ({ ...media }))
}

export function parseCachedAttachments(value: unknown): Screenshot[] {
  if (!Array.isArray(value)) return []
  return value.filter(isCachedMediaReference).map((cachedMedia, index) => ({
    displayId: `${cachedMedia.cacheKey}:${index}`,
    name: cachedMedia.name,
    loadStatus: 'loaded',
    cachedMedia: { ...cachedMedia }
  }))
}

function isDurableGeneratedUrl(value: string | undefined): boolean {
  return Boolean(value && (value.startsWith('https:') || value.startsWith('overlay-media:')))
}

function isGenerationResult(value: unknown): value is GenerationResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<GenerationResult>
  return (
    (result.type === 'image' || result.type === 'video') &&
    (result.status === 'generating' || result.status === 'completed' || result.status === 'failed')
  )
}

function isVideoSubMode(
  value: unknown
): value is NonNullable<DesktopGenerationState['videoSubMode']> {
  return (
    value === 'text-to-video' ||
    value === 'image-to-video' ||
    value === 'reference-to-video' ||
    value === 'motion-control' ||
    value === 'video-editing'
  )
}

function isCachedMediaReference(value: unknown): value is CachedMediaReference {
  if (!value || typeof value !== 'object') return false
  const media = value as Partial<CachedMediaReference>
  return (
    typeof media.cacheKey === 'string' &&
    typeof media.url === 'string' &&
    /^overlay-media:\/\/cache\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9-]{36}\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i.test(
      media.url
    ) &&
    typeof media.mimeType === 'string' &&
    (media.mimeType.startsWith('image/') || media.mimeType.startsWith('video/')) &&
    typeof media.sizeBytes === 'number' &&
    media.sizeBytes >= 0 &&
    media.sizeBytes <= 75 * 1024 * 1024 &&
    typeof media.name === 'string'
  )
}
