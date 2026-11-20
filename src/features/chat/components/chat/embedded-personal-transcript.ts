import type { ChatTranscriptExchangeView } from '@overlay/chat-core'
import { errorLabel, getMessageText, persistedGenerationErrorMessage } from '@overlay/chat-core'
import { readNativeAgentError } from '@/shared/agents/native-agent-error'
import type { LiveSettlement } from './chatTransport'
import { projectPersonalTranscript, type PersonalPendingTurn, type PersonalTranscriptRow } from './personal-transcript'
import { buildNativeTranscriptView } from './useNativePersonalTranscript'
import type { createWebChatTranscriptAdapter } from './toChatTranscriptView'

/** A message sent from another surface whose saved row may not have arrived yet. */
export type EmbeddedPendingSend = { turnId: string; text: string; createdAt: number; modelId?: string }
export type EmbeddedTurnEnd = { turnId: string; outcome: LiveSettlement | 'rejected' }

export type EmbeddedPersonalExchange = {
  exchange: ChatTranscriptExchangeView
  responseInProgress: boolean
  interrupted: boolean
  errorMessage: string | null
}

const FAILED_TURN_MESSAGE = 'The response could not be completed.'

function pendingTurn(send: EmbeddedPendingSend): PersonalPendingTurn {
  return {
    turnId: send.turnId,
    userAcknowledged: false,
    responses: [],
    user: {
      id: send.turnId,
      turnId: send.turnId,
      role: 'user',
      mode: 'act',
      contentType: 'text',
      createdAt: send.createdAt,
      ...(send.modelId ? { model: send.modelId } : {}),
      parts: [{ type: 'text', text: send.text }],
    },
  }
}

/**
 * A personal conversation shown outside the chat route (a note's assistant panel),
 * projected exactly as personal chat projects its saved rows. The send in flight shows
 * its message before the row lands, and a turn this surface saw end never shows a
 * loading mark again, even if its row is still settling.
 */
export function embeddedPersonalExchanges({ rows, pendingSend, endedTurn, toTranscriptView }: {
  rows: readonly PersonalTranscriptRow[]
  pendingSend: EmbeddedPendingSend | null
  endedTurn: EmbeddedTurnEnd | null
  toTranscriptView: ReturnType<typeof createWebChatTranscriptAdapter>
}): EmbeddedPersonalExchange[] {
  const pending = pendingSend ? [pendingTurn(pendingSend)] : []
  const native = buildNativeTranscriptView(projectPersonalTranscript(rows, pending), pending)
  const latest = native.exchanges.length - 1
  const ended = (turnId: string) => endedTurn?.turnId === turnId ? endedTurn.outcome : null
  const inProgress = native.exchanges.map((exchange, index) => {
    const response = exchange.responses.at(-1)
    return index === latest && ended(exchange.turnId) === null
      && (response ? response.status === 'generating' : pendingSend?.turnId === exchange.turnId)
  })
  const latestInterrupted = latest >= 0 && ended(native.exchanges[latest]!.turnId) === 'cancelled'
  const view = toTranscriptView({
    primaryMessages: native.primaryMessages,
    exchangeModes: native.exchangeModes,
    exchangeModels: native.exchangeModels,
    exchangeGenTypes: native.exchangeGenTypes,
    selectedModels: [],
    latestExchangeIndex: latest,
    isActiveLoading: inProgress[latest] === true,
    interruptedExchangeIdx: latestInterrupted ? latest : null,
    getResponseForExchange: (index) => native.exchanges[index]?.responses.at(-1) ?? null,
    getResponsesForExchange: (index) => native.exchanges[index]?.responses ?? [],
  })
  return view.exchanges.map((exchange, index) => {
    const response = native.exchanges[index]?.responses.at(-1)
    const errorMessage = response?.status === 'error'
      ? readNativeAgentError(response.parts)?.message
        ?? errorLabel(new Error(persistedGenerationErrorMessage(getMessageText(response))))
      : ended(exchange.turnId) === 'failed' ? FAILED_TURN_MESSAGE : null
    return {
      exchange,
      responseInProgress: inProgress[index] === true,
      interrupted: index === latest && latestInterrupted && !errorMessage,
      errorMessage,
    }
  })
}
