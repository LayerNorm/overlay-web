import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type {
  ConversationRuntime,
  LiveConversationMessage,
} from '../chat-interface/types'
import { sameAssistantSnapshot } from './chat-runtime-helpers'

export type ServerAssistantMessageRow = {
  agentPlan?: Array<{ id: string; title: string; status: string }>
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
    ...(incoming.agentPlan?.length ? { agentPlan: incoming.agentPlan } : {}),
    turnId: incoming.turnId,
    mode: incoming.mode,
    model: incoming.modelId,
    variantIndex: incoming.variantIndex,
    status: incoming.status,
    ...(incoming.createdAt ? { createdAt: incoming.createdAt } : {}),
    ...(incoming.updatedAt ? { updatedAt: incoming.updatedAt } : {}),
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
    // A row still generating holds nothing yet, so keep what the stream already showed.
    if (incoming.status === 'generating' && !incoming.parts?.length && !incoming.content) return false
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
  // Personal chat runs save 'ask' rows, which only need patching while a run is being followed.
  { includeAskRows = false }: { includeAskRows?: boolean } = {},
) {
  let changed = false
  for (const incoming of liveMessages) {
    if ((incoming.mode !== 'act' && !includeAskRows) || (incoming.variantIndex ?? 0) !== 0) continue
    changed = patchMessageIntoList(runtime.actChat.messages as UIMessage[], incoming) || changed
    changed = patchMessageIntoList(runtime.askChats[0].messages as UIMessage[], incoming) || changed
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
    ...(incoming.agentPlan?.length ? { agentPlan: incoming.agentPlan } : {}),
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
    if ((incoming.variantIndex ?? 0) !== 0) continue
    changed = patchServerMessageIntoList(runtime.actChat.messages as UIMessage[], incoming) || changed
    changed = patchServerMessageIntoList(runtime.askChats[0].messages as UIMessage[], incoming) || changed
  }
  return changed
}

export function cloneRuntimeMessageArrays(runtime: ConversationRuntime) {
  runtime.actChat.messages = [...runtime.actChat.messages]
  runtime.askChats[0].messages = [...runtime.askChats[0].messages]
}
