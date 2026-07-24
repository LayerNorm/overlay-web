import type { ConversationMessagePart } from '@overlay/chat-core'
import type { Message } from '../components/chat'
import { desktopAppJson, desktopAppStreamText } from './app-api-client'
import { screenshotUrl } from '../utils/chatMediaPersistence'

/**
 * Stream chunks emitted by {@link streamCloudActMessage}. Text, reasoning,
 * tool, and file deltas are carried as shared {@link ConversationMessagePart}
 * structures from `@overlay/chat-core` so the desktop accumulates message parts
 * the same way the web app does. Use {@link mergeStreamingConversationParts}
 * (from `@overlay/chat-core`) to fold `chunk.parts` into an existing part list,
 * and {@link finalizeStreamingConversationParts} when `chunk.type === 'done'`.
 */
export type DesktopActStreamChunk =
  | { type: 'parts'; parts: ConversationMessagePart[] }
  | { type: 'error'; content: string }
  | { type: 'done' }

/** @deprecated Alias kept for callers that still reference the old name. */
export type CloudChatChunk = DesktopActStreamChunk

type UiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string }

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: UiMessagePart[]
  metadata?: Record<string, unknown>
}

function textParts(content: string): UiMessagePart[] {
  return [{ type: 'text', text: content }]
}

function messageTextForModel(message: Message, modelId?: string): string {
  if (message.role === 'assistant' && message.responses?.length) {
    return (
      message.responses.find((response) => response.modelId === modelId)?.content ||
      message.responses[0]?.content ||
      message.content ||
      ''
    )
  }
  return message.content || ''
}

export function toUiMessages(messages: Message[], modelId?: string): UiMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const parts: UiMessagePart[] = [...textParts(messageTextForModel(message, modelId))]
      if (message.role === 'user' && message.screenshots?.length) {
        for (const screenshot of message.screenshots) {
          const url = screenshotUrl(screenshot)
          if (!url) continue
          parts.push({
            type: 'file',
            mediaType: screenshot.cachedMedia?.mimeType ?? 'image/png',
            url
          })
        }
      }
      return {
        id: message.id,
        role: message.role,
        parts
      }
    })
}

/**
 * Parse a single SSE payload into a shared {@link ConversationMessagePart}
 * delta (or null for keep-alive / [DONE] frames). The part `id` is left blank
 * and assigned by {@link mergeStreamingConversationParts} when omitted.
 */
function parseStreamPart(payload: string): ConversationMessagePart | null {
  if (!payload || payload === '[DONE]') return null
  try {
    const event = JSON.parse(payload) as {
      type?: string
      delta?: unknown
      text?: unknown
      errorText?: unknown
      error?: unknown
      toolName?: unknown
      toolCallId?: unknown
      input?: unknown
      output?: unknown
      state?: unknown
      url?: unknown
      mediaType?: unknown
    }
    if ((event.type === 'text-delta' || event.type === 'text') && typeof event.delta === 'string') {
      return { type: 'text', id: '', text: event.delta }
    }
    if ((event.type === 'text-delta' || event.type === 'text') && typeof event.text === 'string') {
      return { type: 'text', id: '', text: event.text }
    }
    if (event.type === 'reasoning-delta' && typeof event.delta === 'string') {
      return { type: 'reasoning', id: '', text: event.delta, state: 'streaming' }
    }
    if (
      (event.type === 'tool-input-streaming' ||
        event.type === 'tool-input-available' ||
        event.type === 'tool-input-error') &&
      typeof event.toolCallId === 'string' &&
      typeof event.toolName === 'string'
    ) {
      return {
        type: 'tool',
        id: '',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state:
          event.type === 'tool-input-error'
            ? 'input-error'
            : event.type === 'tool-input-streaming'
              ? 'input-streaming'
              : 'input-available',
        input: event.input,
        errorText: typeof event.errorText === 'string' ? event.errorText : undefined
      }
    }
    if (
      (event.type === 'tool-output-available' ||
        event.type === 'tool-output-error' ||
        event.type === 'tool-output-denied') &&
      typeof event.toolCallId === 'string'
    ) {
      return {
        type: 'tool',
        id: '',
        toolCallId: event.toolCallId,
        toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown_tool',
        state:
          event.type === 'tool-output-error'
            ? 'output-error'
            : event.type === 'tool-output-denied'
              ? 'output-denied'
              : 'output-available',
        output: event.output,
        errorText: typeof event.errorText === 'string' ? event.errorText : undefined
      }
    }
    if (
      event.type === 'file' &&
      typeof event.url === 'string' &&
      typeof event.mediaType === 'string'
    ) {
      return { type: 'file', id: '', url: event.url, mediaType: event.mediaType }
    }
  } catch {
    return null
  }
  return null
}

function parseStreamChunk(payload: string): DesktopActStreamChunk | null {
  if (!payload) return null
  if (payload === '[DONE]') return { type: 'done' }
  try {
    const event = JSON.parse(payload) as { type?: string; errorText?: unknown; error?: unknown }
    if (event.type === 'error') {
      const content =
        typeof event.errorText === 'string'
          ? event.errorText
          : typeof event.error === 'string'
            ? event.error
            : 'Cloud chat request failed'
      return { type: 'error', content }
    }
    if (event.type === 'finish' || event.type === 'done') {
      return { type: 'done' }
    }
  } catch {
    return null
  }
  const part = parseStreamPart(payload)
  if (part) return { type: 'parts', parts: [part] }
  return null
}

export async function streamCloudActMessage(params: {
  conversationId?: string
  turnId: string
  modelId: string
  messages: Message[]
  mode?: 'chat' | 'automate'
  systemPrompt?: string
  multiModelSlotIndex?: number
  multiModelTotal?: number
  onChunk: (chunk: DesktopActStreamChunk) => void
}): Promise<void> {
  let buffer = ''
  let terminalEventReceived = false
  await desktopAppStreamText(
    '/api/v1/conversations/act',
    {
      method: 'POST',
      body: JSON.stringify({
        conversationId: params.conversationId,
        turnId: params.turnId,
        modelId: params.modelId,
        mode: params.mode ?? 'chat',
        systemPrompt: params.systemPrompt,
        multiModelSlotIndex: params.multiModelSlotIndex,
        multiModelTotal: params.multiModelTotal,
        messages: toUiMessages(params.messages, params.modelId)
      })
    },
    (chunkText) => {
      buffer += chunkText
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line
        const chunk = parseStreamChunk(payload)
        if (chunk) {
          params.onChunk(chunk)
          if (chunk.type === 'done') {
            terminalEventReceived = true
            buffer = ''
            return false
          }
        }
      }
      return true
    }
  )

  if (terminalEventReceived) return
  if (buffer.trim()) {
    const payload = buffer.trim().startsWith('data:')
      ? buffer.trim().slice(5).trim()
      : buffer.trim()
    const chunk = parseStreamChunk(payload)
    if (chunk) {
      params.onChunk(chunk)
      if (chunk.type === 'done') return
    }
  }
  params.onChunk({ type: 'done' })
}

export async function generateCloudChatTitle(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const data = await desktopAppJson<{ title?: string | null }>('/api/v1/generate-title', {
    method: 'POST',
    body: JSON.stringify({ text: trimmed })
  })
  return data.title?.trim() || null
}
