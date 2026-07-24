import type {
  ConversationMessage,
  ConversationMessagePart,
  MessageReasoningPart,
  MessageTextPart,
  MessageToolPart,
  MessageFilePart
} from '@overlay/chat-core'
import type { AgentStep, Message, MessageRenderPart } from './types'

/**
 * Data adapter: converts desktop Message[] to shared ConversationMessage[]
 * for use with @overlay/chat-react components.
 *
 * Desktop messages carry multi-model responses, agent steps, and legacy
 * content fields. This adapter selects the active response and extracts
 * render parts using the canonical transcript fallback chain:
 *   1. selected response's renderParts
 *   2. message-level renderParts
 *   3. agentSteps → renderParts conversion
 *   4. plain content text
 *
 * Parts are normalized so malformed remote/local data cannot crash the
 * shared renderer with null text or missing tool fields.
 */

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeRenderPart(
  part: MessageRenderPart | null | undefined,
  fallbackId: string
): ConversationMessagePart | null {
  if (!part || typeof part !== 'object') return null
  const id = typeof part.id === 'string' && part.id ? part.id : fallbackId

  switch (part.type) {
    case 'text': {
      const textPart: MessageTextPart = {
        type: 'text',
        id,
        text: asText((part as MessageTextPart).text)
      }
      return textPart
    }
    case 'reasoning': {
      const reasoning = part as MessageReasoningPart
      const text = asText(reasoning.text)
      if (!text && reasoning.state !== 'streaming') return null
      const reasoningPart: MessageReasoningPart = {
        type: 'reasoning',
        id,
        text,
        state: reasoning.state === 'streaming' ? 'streaming' : 'done'
      }
      return reasoningPart
    }
    case 'tool': {
      const tool = part as MessageToolPart
      const toolPart: MessageToolPart = {
        type: 'tool',
        id,
        toolCallId: typeof tool.toolCallId === 'string' && tool.toolCallId ? tool.toolCallId : id,
        toolName:
          typeof tool.toolName === 'string' && tool.toolName ? tool.toolName : 'unknown_tool',
        state:
          tool.state === 'input-streaming' ||
          tool.state === 'input-available' ||
          tool.state === 'input-error' ||
          tool.state === 'output-available' ||
          tool.state === 'output-error' ||
          tool.state === 'output-denied'
            ? tool.state
            : 'output-available',
        input: tool.input,
        inputText: tool.inputText,
        output: tool.output,
        errorText: tool.errorText,
        providerExecuted: tool.providerExecuted,
        dynamic: tool.dynamic,
        title: tool.title
      }
      return toolPart
    }
    case 'file': {
      const file = part as MessageFilePart
      if (!file.url || !file.mediaType) return null
      const filePart: MessageFilePart = {
        type: 'file',
        id,
        url: file.url,
        mediaType: file.mediaType
      }
      return filePart
    }
    default:
      // Keep source/data-like parts as-is when they already look usable.
      if (typeof (part as { type?: unknown }).type === 'string') {
        return { ...(part as ConversationMessagePart), id }
      }
      return null
  }
}

function normalizeRenderParts(
  parts: MessageRenderPart[] | undefined,
  messageId: string
): ConversationMessagePart[] {
  if (!parts?.length) return []
  const out: ConversationMessagePart[] = []
  for (const [index, part] of parts.entries()) {
    const normalized = normalizeRenderPart(part, `${messageId}:part:${index}`)
    if (normalized) out.push(normalized)
  }
  return out
}

function renderPartsFromAgentSteps(steps: AgentStep[], messageId: string): MessageRenderPart[] {
  const parts: MessageRenderPart[] = []
  const toolIds = new Map<string, string>()
  for (const [index, step] of steps.entries()) {
    if (step.type === 'thinking' && step.thinking) {
      parts.push({
        type: 'reasoning',
        id: `${messageId}:reasoning:${index}`,
        text: asText(step.thinking),
        state: 'done'
      })
    } else if (step.type === 'tool_start' && step.tool) {
      const id = `${messageId}:tool:${index}`
      toolIds.set(step.tool, id)
      parts.push({
        type: 'tool',
        id,
        toolCallId: id,
        toolName: step.tool,
        state: 'input-available',
        input: step.toolInput
      })
    } else if (step.type === 'tool_result' && step.tool) {
      const existingId = toolIds.get(step.tool)
      const existing = existingId
        ? parts.find(
            (part): part is Extract<MessageRenderPart, { type: 'tool' }> =>
              part.type === 'tool' && part.id === existingId
          )
        : undefined
      if (existing) {
        existing.state = 'output-available'
        existing.output = step.toolResult
      } else {
        parts.push({
          type: 'tool',
          id: `${messageId}:tool-result:${index}`,
          toolCallId: `${messageId}:tool-result:${index}`,
          toolName: step.tool,
          state: 'output-available',
          output: step.toolResult
        })
      }
    } else if (step.type === 'text' && step.text) {
      parts.push({ type: 'text', id: `${messageId}:text:${index}`, text: asText(step.text) })
    } else if (step.type === 'error' && step.error) {
      parts.push({
        type: 'text',
        id: `${messageId}:error:${index}`,
        text: `Error: ${asText(step.error)}`
      })
    }
  }
  return parts
}

function selectedRenderParts(message: Message): ConversationMessagePart[] {
  const safeContent = asText(message.content)
  if (message.role === 'user') {
    return [{ type: 'text', id: `${message.id}:text`, text: safeContent }]
  }

  const selectedResponse =
    message.responses?.find((response) => response.modelId === message.selectedModelId) ??
    message.responses?.[0]

  const fromSelected = normalizeRenderParts(selectedResponse?.renderParts, message.id)
  if (fromSelected.length) return fromSelected

  const fromMessage = normalizeRenderParts(message.renderParts, message.id)
  if (fromMessage.length) return fromMessage

  if (message.agentSteps?.length) {
    return normalizeRenderParts(
      renderPartsFromAgentSteps(message.agentSteps, message.id),
      message.id
    )
  }

  return [{ type: 'text', id: `${message.id}:text`, text: safeContent }]
}

/**
 * Convert a desktop Message to a shared ConversationMessage.
 * Desktop-specific fields (mentions, screenshots) are not part of the shared
 * type and are handled by the wrapper component separately.
 */
export function desktopMessageToConversation(message: Message): ConversationMessage {
  const parts = selectedRenderParts(message)
  const selectedResponse =
    message.responses?.find((response) => response.modelId === message.selectedModelId) ??
    message.responses?.[0]

  return {
    id: message.id || `msg-${Date.now()}`,
    role: message.role === 'user' ? 'user' : 'assistant',
    parts,
    createdAt: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    turnId: message.turnId,
    modelId: message.selectedModelId ?? selectedResponse?.modelId,
    metadata: selectedResponse
      ? {
          routedModelId: selectedResponse.modelId,
          statusLabel: selectedResponse.modelName
        }
      : undefined
  }
}
