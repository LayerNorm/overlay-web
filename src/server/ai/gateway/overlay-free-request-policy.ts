import 'server-only'

import type {
  LanguageModelV4CallOptions,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'
import {
  asRecord,
  type FreeRouteCapabilities,
} from '@/shared/ai/gateway/overlay-free-policy'
import type { OverlayFreeRoute } from './overlay-free-router-contracts'

export function parseOverlayFreeCapabilities(route: OverlayFreeRoute): FreeRouteCapabilities | null {
  try {
    const value = asRecord(JSON.parse(route.capabilitiesJson))
    if (typeof value.contextWindow !== 'number' || !Number.isFinite(value.contextWindow) || value.contextWindow <= 0) return null
    return {
      contextWindow: value.contextWindow,
      maxOutputTokens: typeof value.maxOutputTokens === 'number' && Number.isFinite(value.maxOutputTokens) && value.maxOutputTokens > 0
        ? value.maxOutputTokens
        : value.contextWindow,
      supportsTools: value.supportsTools === true,
      supportsVision: value.supportsVision === true,
      supportsJson: value.supportsJson === true,
    }
  } catch (_error) {
    return null
  }
}

export function overlayFreePrivacyRequested(options: LanguageModelV4CallOptions): boolean {
  const providerOptions = asRecord(options.providerOptions)
  const gateway = asRecord(providerOptions.gateway)
  const openrouter = asRecord(providerOptions.openrouter)
  const openrouterProvider = asRecord(openrouter.provider)
  return gateway.zeroDataRetention === true ||
    openrouterProvider.zdr === true ||
    openrouterProvider.data_collection === 'deny'
}

function promptParts(options: LanguageModelV4CallOptions): Record<string, unknown>[] {
  return options.prompt.flatMap((message) => Array.isArray(message.content)
    ? message.content.map(asRecord)
    : [])
}

function toolResultParts(part: Record<string, unknown>): Record<string, unknown>[] {
  if (part.type !== 'tool-result') return []
  const output = asRecord(part.output)
  return output.type === 'content' && Array.isArray(output.value)
    ? output.value.map(asRecord)
    : []
}

function hasToolHistory(options: LanguageModelV4CallOptions): boolean {
  return options.tools?.length !== undefined && options.tools.length > 0 ||
    options.prompt.some((message) => message.role === 'tool') ||
    promptParts(options).some((part) => part.type === 'tool-call' || part.type === 'tool-result')
}

export function hasProviderExecutedOverlayFreeTool(options: LanguageModelV4CallOptions): boolean {
  return options.tools?.some((tool) => tool.type === 'provider') === true ||
    promptParts(options).some((part) => part.type === 'tool-call' && part.providerExecuted === true)
}

function mediaType(part: Record<string, unknown>): string {
  return typeof part.mediaType === 'string' ? part.mediaType.toLowerCase() : ''
}

function isImageMediaType(value: string): boolean {
  return value === 'image' || value.startsWith('image/')
}

function isImagePart(part: Record<string, unknown>): boolean {
  return ['file', 'reasoning-file', 'file-data', 'file-url'].includes(String(part.type)) &&
    isImageMediaType(mediaType(part)) ||
    part.type === 'image-data' || part.type === 'image-url'
}

function urlIsHttps(part: Record<string, unknown>): boolean {
  const data = asRecord(part.data)
  const candidate = typeof part.url === 'string' ? part.url : data.type === 'url' ? data.url : undefined
  if (candidate instanceof URL) return candidate.protocol === 'https:'
  if (typeof candidate !== 'string') return true
  try {
    return new URL(candidate).protocol === 'https:'
  } catch (_error) {
    return false
  }
}

function hasImagePrompt(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) =>
    isImagePart(part) || toolResultParts(part).some(isImagePart))
}

export function hasUnsupportedOverlayFreeMedia(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) => {
    const items = [part, ...toolResultParts(part)]
    return items.some((item) => {
      if (item.type === 'audio' || item.type === 'video') return true
      if (item.type === 'file' || item.type === 'reasoning-file' ||
        item.type === 'file-data' || item.type === 'file-url') {
        const type = mediaType(item)
        return !isImageMediaType(type) && type !== 'text' && !type.startsWith('text/')
      }
      if (item.type === 'image-data' || item.type === 'image-url') return false
      return false
    })
  })
}

export function hasInsecureOverlayFreeImageUrl(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) =>
    [part, ...toolResultParts(part)].some((item) => isImagePart(item) && !urlIsHttps(item)))
}

function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt.map((message) => {
    if (typeof message.content === 'string') return message.content
    return message.content.map((part) => {
      const value = asRecord(part)
      if (typeof value.text === 'string') return value.text
      const data = asRecord(value.data)
      if (data.type === 'text' && typeof data.text === 'string') return data.text
      if (value.type === 'tool-call') return JSON.stringify(value.input)
      if (value.type === 'tool-result') {
        const output = asRecord(value.output)
        if (output.type === 'content' && Array.isArray(output.value)) {
          return output.value.map((item) => {
            const content = asRecord(item)
            if (typeof content.text === 'string') return content.text
            const data = asRecord(content.data)
            return data.type === 'text' && typeof data.text === 'string' ? data.text : ''
          }).join('')
        }
        return JSON.stringify(output)
      }
      return ''
    }).join('')
  }).join('')
}

function imageCount(options: LanguageModelV4CallOptions): number {
  return promptParts(options).reduce((count, part) =>
    count + Number(isImagePart(part)) + toolResultParts(part).filter(isImagePart).length, 0)
}

function contextEstimate(options: LanguageModelV4CallOptions): number {
  const textBytes = new TextEncoder().encode(promptText(options)).byteLength
  const toolBytes = new TextEncoder().encode(JSON.stringify(options.tools ?? [])).byteLength
  return textBytes + toolBytes + imageCount(options) * 8192
}

export function overlayFreeRouteSupports(
  capabilities: FreeRouteCapabilities,
  options: LanguageModelV4CallOptions,
): boolean {
  if (hasToolHistory(options) && !capabilities.supportsTools) return false
  if (options.responseFormat?.type === 'json' && !capabilities.supportsJson) return false
  if (hasImagePrompt(options) && !capabilities.supportsVision) return false
  const output = options.maxOutputTokens ?? Math.min(4096, capabilities.maxOutputTokens)
  if (output > capabilities.maxOutputTokens) return false
  return contextEstimate(options) + output <= capabilities.contextWindow
}

export function trustedOverlayFreeOptions(
  options: LanguageModelV4CallOptions,
  route: OverlayFreeRoute,
  capabilities: FreeRouteCapabilities,
): LanguageModelV4CallOptions {
  const providerOptions: SharedV4ProviderOptions = route.transport === 'gateway'
    ? { gateway: { only: [route.provider], models: [] } }
    : { openrouter: { models: [], provider: { require_parameters: true } } }
  const prompt: LanguageModelV4CallOptions['prompt'] = options.prompt.map((message) => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content }
    }
    const { providerOptions: _messageOptions, ...safeMessage } = message
    return safeMessage
  })
  return {
    ...options,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? Math.min(4096, capabilities.maxOutputTokens),
    headers: undefined,
    providerOptions,
  }
}
