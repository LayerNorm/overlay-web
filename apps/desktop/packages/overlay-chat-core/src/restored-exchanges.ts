import { getMessageText } from './messages'
import type { GenerationResult, RestoredOutputGroup } from './types'

export type RestorableConversationMessage = {
  id: string
  turnId?: string
  mode?: 'ask' | 'act'
  role: 'user' | 'assistant'
  parts: Array<{ type: string; text?: string }>
  model?: string
  status?: 'generating' | 'completed' | 'error'
}

export type RestoredMessageExchange<TMessage extends RestorableConversationMessage> = {
  userMsg: TMessage
  responses: Array<{ model: string; msg: TMessage }>
  mode: 'ask' | 'act'
}

export function syntheticMessagesForOutputGroups<TMessage extends RestorableConversationMessage>(
  outputGroups: RestoredOutputGroup[],
): TMessage[] {
  return outputGroups.map((group, idx) => ({
    id: `restored-output-${idx}`,
    turnId: `out-${idx}`,
    mode: 'ask' as const,
    role: 'user' as const,
    parts: [{ type: 'text', text: group.prompt }],
  } as TMessage))
}

export function buildRestoredMessageExchanges<TMessage extends RestorableConversationMessage>(
  rawMessages: TMessage[],
  options: {
    defaultModelId: string
    hasAutomationContext: boolean
    onOrphanAssistantTurn?: (turnId: string) => void
  },
): Array<RestoredMessageExchange<TMessage>> {
  const exchanges: Array<RestoredMessageExchange<TMessage>> = []
  const hasTurnIds = rawMessages.some((message) => message.turnId)

  if (!hasTurnIds) {
    let current: RestoredMessageExchange<TMessage> | null = null
    for (const message of rawMessages) {
      if (message.role === 'user') {
        if (current) exchanges.push(current)
        current = { userMsg: message, responses: [], mode: 'ask' }
      } else if (message.role === 'assistant' && current) {
        current.responses.push({ model: message.model || options.defaultModelId, msg: message })
      }
    }
    if (current) exchanges.push(current)
    return exchanges
  }

  const turnOrder: string[] = []
  const byTurn = new Map<string, { user?: TMessage; assistants: TMessage[] }>()
  for (const message of rawMessages) {
    const turnId = message.turnId || message.id
    if (!byTurn.has(turnId)) {
      byTurn.set(turnId, { assistants: [] })
      turnOrder.push(turnId)
    }
    const group = byTurn.get(turnId)!
    if (message.role === 'user') group.user = message
    else group.assistants.push(message)
  }

  for (const turnId of turnOrder) {
    const group = byTurn.get(turnId)!
    if (!group.user && group.assistants.length > 0) {
      options.onOrphanAssistantTurn?.(turnId)
      const mode = (group.assistants[0]?.mode || 'ask') as 'ask' | 'act'
      const orphanResponses = group.assistants.map((assistant) => ({
        model: assistant.model || options.defaultModelId,
        msg: assistant,
      }))
      const previous = exchanges[exchanges.length - 1]
      if (previous) {
        previous.responses.push(...orphanResponses)
      } else {
        exchanges.push({
          userMsg: {
            id: `synthetic-user-${turnId}`,
            turnId,
            role: 'user',
            mode,
            parts: [{ type: 'text', text: '[Earlier message unavailable]' }],
          } as TMessage,
          responses: orphanResponses,
          mode,
        })
      }
      continue
    }

    if (!group.user) continue
    const mode = (group.assistants[0]?.mode || group.user.mode || 'ask') as 'ask' | 'act'
    const responses = group.assistants.map((assistant) => ({
      model: assistant.model || options.defaultModelId,
      msg: assistant,
    }))
    if (options.hasAutomationContext && responses.length === 0) {
      responses.push({
        model: options.defaultModelId,
        msg: {
          id: `missing-automation-response-${turnId}`,
          turnId,
          role: 'assistant',
          mode,
          parts: [{
            type: 'text',
            text: 'No saved model response was found for this automation run. You can retry this turn to regenerate it.',
          }],
          status: 'error',
        } as TMessage,
      })
    }
    exchanges.push({ userMsg: group.user, responses, mode })
  }

  return exchanges
}

export function restoreGenerationStateForExchanges<TMessage extends RestorableConversationMessage>(
  exchanges: Array<RestoredMessageExchange<TMessage>>,
  outputGroups: RestoredOutputGroup[],
): {
  exchangeGenTypes: ('text' | 'image' | 'video')[]
  exchangeModels: string[][]
  generationResults: Map<number, GenerationResult[]>
} {
  const exchangeGenTypes: ('text' | 'image' | 'video')[] = exchanges.map(() => 'text')
  const exchangeModels = exchanges.map((exchange) => exchange.responses.map((response) => response.model))
  const generationResults = new Map<number, GenerationResult[]>()

  let nextOutputGroupIdx = 0
  for (let idx = 0; idx < exchanges.length; idx++) {
    const exchangeTurnId = exchanges[idx]!.userMsg.turnId?.trim() || null
    const userPrompt = getMessageText(exchanges[idx]!.userMsg).trim()
    const matchIdx = outputGroups.findIndex((group, groupIdx) => {
      if (groupIdx < nextOutputGroupIdx) return false
      if (exchangeTurnId) {
        const groupTurnId = group.turnId?.trim() || null
        return groupTurnId === exchangeTurnId
      }
      return !group.turnId?.trim() && group.prompt.trim() === userPrompt
    })
    if (matchIdx === -1) continue

    const group = outputGroups[matchIdx]!
    nextOutputGroupIdx = matchIdx + 1
    exchangeGenTypes[idx] = group.type
    generationResults.set(idx, group.results)
    exchangeModels[idx] = group.modelIds
  }

  return { exchangeGenTypes, exchangeModels, generationResults }
}
