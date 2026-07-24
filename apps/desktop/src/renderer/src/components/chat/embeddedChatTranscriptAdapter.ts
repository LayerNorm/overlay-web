import type { MessageRenderPart, Message } from './types'

export interface EmbeddedPlanStep {
  id: number
  text: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export type EmbeddedChatItem =
  | { type: 'user'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_call'
      tool: string
      toolInput?: Record<string, unknown>
      toolResult?: string
      isLoading?: boolean
    }
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }
  | { type: 'plan'; steps: EmbeddedPlanStep[] }
  | { type: 'session_complete'; summary?: string }

export interface EmbeddedChatTranscriptAdapterOptions {
  idPrefix: string
  isRunning: boolean
  mode: 'ask' | 'act'
  modelId?: string
  planSteps?: readonly EmbeddedPlanStep[]
}

interface EmbeddedTurn {
  index: number
  userText: string
  assistantItems: EmbeddedChatItem[]
}

export function embeddedChatItemsToMessages(
  items: readonly EmbeddedChatItem[],
  options: EmbeddedChatTranscriptAdapterOptions
): Message[] {
  const turns: EmbeddedTurn[] = []

  for (const item of items) {
    if (item.type === 'user') {
      turns.push({ index: turns.length, userText: item.text, assistantItems: [] })
      continue
    }

    const turn = turns[turns.length - 1] ?? {
      index: 0,
      userText: '',
      assistantItems: []
    }
    if (turns.length === 0) turns.push(turn)
    turn.assistantItems.push(item)
  }

  if (turns.length === 0 && options.isRunning) {
    turns.push({ index: 0, userText: '', assistantItems: [] })
  }

  return turns.flatMap((turn, turnIndex) => {
    const turnId = `${options.idPrefix}:turn:${turn.index}`
    const user: Message = {
      id: `${turnId}:user`,
      turnId,
      role: 'user',
      content: turn.userText,
      timestamp: turn.index * 2
    }
    const active = options.isRunning && turnIndex === turns.length - 1
    const parts = embeddedAssistantParts(turn.assistantItems, {
      active,
      idPrefix: `${turnId}:assistant`,
      planSteps: options.planSteps
    })
    const error = turn.assistantItems.findLast(
      (item): item is Extract<EmbeddedChatItem, { type: 'error' }> => item.type === 'error'
    )
    const executingTool =
      active &&
      turn.assistantItems.some(
        (item) => item.type === 'tool_call' && (item.isLoading ?? !item.toolResult)
      )
    const assistantId = `${turnId}:assistant`
    const assistant: Message = {
      id: assistantId,
      turnId,
      role: 'assistant',
      content: visibleAssistantText(parts),
      timestamp: turn.index * 2 + 1,
      renderParts: parts,
      selectedModelId: options.modelId ?? 'overlay-agent',
      status: error
        ? 'error'
        : executingTool
          ? 'executing-tool'
          : active
            ? parts.length
              ? 'streaming'
              : 'submitted'
            : 'completed',
      isAgentMessage: options.mode === 'act'
    }

    return turn.assistantItems.length || active ? [user, assistant] : [user]
  })
}

function embeddedAssistantParts(
  items: readonly EmbeddedChatItem[],
  options: {
    active: boolean
    idPrefix: string
    planSteps?: readonly EmbeddedPlanStep[]
  }
): MessageRenderPart[] {
  return items.flatMap((item, index): MessageRenderPart[] => {
    const id = `${options.idPrefix}:part:${index}`
    switch (item.type) {
      case 'thinking':
        return [
          {
            type: 'reasoning',
            id,
            text: item.text,
            state: options.active ? 'streaming' : 'done'
          }
        ]
      case 'tool_call': {
        const loading = item.isLoading ?? (options.active && item.toolResult === undefined)
        return [
          {
            type: 'tool',
            id,
            toolCallId: id,
            toolName: item.tool || 'unknown_tool',
            state: loading ? 'input-available' : 'output-available',
            input: item.toolInput,
            output: item.toolResult
          }
        ]
      }
      case 'text':
        return item.text.trim() ? [{ type: 'text', id, text: item.text }] : []
      case 'error':
        return [{ type: 'text', id, text: `Task failed: ${item.text}` }]
      case 'plan': {
        const steps = options.planSteps?.length ? options.planSteps : item.steps
        return [{ type: 'text', id, text: planMarkdown(steps) }]
      }
      case 'session_complete':
        return [
          {
            type: 'text',
            id,
            text: item.summary?.trim()
              ? `Session complete\n\n${item.summary.trim()}`
              : 'Session complete'
          }
        ]
      case 'user':
        return []
    }
  })
}

function planMarkdown(steps: readonly EmbeddedPlanStep[]): string {
  const rows = steps.map((step) => {
    const marker = step.status === 'completed' ? '[x]' : '[ ]'
    const suffix =
      step.status === 'in_progress' ? ' — in progress' : step.status === 'failed' ? ' — failed' : ''
    return `- ${marker} ${step.text}${suffix}`
  })
  return ['Plan', '', ...rows].join('\n')
}

function visibleAssistantText(parts: readonly MessageRenderPart[]): string {
  return parts
    .filter((part): part is Extract<MessageRenderPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
}
