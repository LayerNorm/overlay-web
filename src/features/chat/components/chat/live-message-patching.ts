import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type {
  ConversationRuntime,
  LiveConversationMessage,
} from '../chat-interface/types'
import { sameAssistantSnapshot } from './chat-runtime-helpers'

export type ServerAssistantMessageRow = {
  id: string
  turnId?: string
  role: 'assistant'
  mode?: 'ask' | 'act'
  parts?: Array<Record<string, unknown>>
  model?: string
  variantIndex?: number
  routedModelId?: string
  status?: 'generating' | 'completed' | 'error'
}

function patchMessageIntoList(messages: UIMessage[], incoming: LiveConversationMessage) {
  if (incoming.role !== 'assistant') return false
  const variant = incoming.variantIndex ?? 0
  const nextMessage = {
    id: incoming._id,
    role: 'assistant' as const,
    parts: incoming.parts?.length
      ? incoming.parts
      : [{ type: 'text', text: incoming.content ?? '' }],
    metadata: {
      ...(incoming.routedModelId ? { routedModelId: incoming.routedModelId } : {}),
    },
    turnId: incoming.turnId,
    mode: incoming.mode,
    model: incoming.modelId,
    variantIndex: incoming.variantIndex,
    status: incoming.status,
  } as unknown as UIMessage

  const existingIdx = messages.findIndex((message) => {
    const m = message as unknown as { id?: string; turnId?: string; role?: string; variantIndex?: number }
    return (
      m.id === incoming._id ||
      (m.role === 'assistant' &&
        m.turnId === incoming.turnId &&
        (m.variantIndex ?? 0) === variant)
    )
  })
  if (existingIdx >= 0) {
    if (sameAssistantSnapshot(messages[existingIdx], nextMessage)) {
      return false
    }
    messages[existingIdx] = nextMessage
    return true
  }
  const userIdx = messages.findIndex((message) => {
    const m = message as unknown as { turnId?: string; id?: string; role?: string }
    return m.role === 'user' && (m.turnId === incoming.turnId || m.id === incoming.turnId)
  })
  if (userIdx >= 0) {
    messages.splice(userIdx + 1, 0, nextMessage)
    return true
  }
  return false
}

export function patchLiveMessagesIntoRuntime(
  runtime: ConversationRuntime,
  liveMessages: readonly LiveConversationMessage[],
) {
  let changed = false
  for (const incoming of liveMessages) {
    if (incoming.mode !== 'act') continue
    changed = patchMessageIntoList(runtime.actChat.messages as UIMessage[], incoming) || changed
    const slot = incoming.variantIndex ?? 0
    if (slot >= 0 && slot < runtime.askChats.length) {
      changed = patchMessageIntoList(runtime.askChats[slot]!.messages as UIMessage[], incoming) || changed
    }
  }
  return changed
}

function patchServerMessageIntoList(messages: UIMessage[], incoming: ServerAssistantMessageRow) {
  const variant = incoming.variantIndex ?? 0
  const nextMessage = {
    id: incoming.id,
    role: 'assistant' as const,
    parts: incoming.parts?.length ? incoming.parts : [{ type: 'text', text: '' }],
    metadata: {
      ...(incoming.routedModelId ? { routedModelId: incoming.routedModelId } : {}),
    },
    turnId: incoming.turnId,
    mode: incoming.mode ?? 'act',
    model: incoming.model,
    variantIndex: incoming.variantIndex,
    status: incoming.status,
  } as unknown as UIMessage
  const existingIdx = messages.findIndex((message) => {
    const m = message as unknown as { id?: string; turnId?: string; role?: string; variantIndex?: number }
    return (
      m.id === incoming.id ||
      (m.role === 'assistant' &&
        m.turnId === incoming.turnId &&
        (m.variantIndex ?? 0) === variant)
    )
  })
  if (existingIdx < 0) {
    const userIdx = messages.findIndex((message) => {
      const m = message as unknown as { id?: string; turnId?: string; role?: string }
      return m.role === 'user' && (m.turnId === incoming.turnId || m.id === incoming.turnId)
    })
    if (userIdx < 0) return false
    messages.splice(userIdx + 1, 0, nextMessage)
    return true
  }
  const existing = messages[existingIdx] as unknown as { parts?: unknown; status?: string }
  if (
    existing.status === incoming.status &&
    JSON.stringify(existing.parts ?? []) === JSON.stringify((nextMessage as unknown as { parts?: unknown }).parts ?? [])
  ) {
    return false
  }
  messages[existingIdx] = nextMessage
  return true
}

export function patchServerAssistantRowsIntoRuntime(
  runtime: ConversationRuntime,
  assistantRows: readonly ServerAssistantMessageRow[],
) {
  let changed = false
  for (const incoming of assistantRows) {
    if ((incoming.mode ?? 'act') !== 'act') continue
    changed = patchServerMessageIntoList(runtime.actChat.messages as UIMessage[], incoming) || changed
    const slot = incoming.variantIndex ?? 0
    if (slot >= 0 && slot < runtime.askChats.length) {
      changed = patchServerMessageIntoList(runtime.askChats[slot]!.messages as UIMessage[], incoming) || changed
    }
  }
  return changed
}

export function cloneRuntimeMessageArrays(runtime: ConversationRuntime) {
  runtime.actChat.messages = [...runtime.actChat.messages]
  for (const chat of runtime.askChats) chat.messages = [...chat.messages]
}
