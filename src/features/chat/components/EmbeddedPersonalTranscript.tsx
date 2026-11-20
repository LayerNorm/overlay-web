'use client'

import { useMemo, type ReactNode } from 'react'
import { ChatExchange, ChatTranscript, type ChatTranscriptPresentation } from '@overlay/chat-react/transcript'
import type { ChatTranscriptExchangeView } from '@overlay/chat-core'
import { usePersonalConversationTranscript } from '@/components/providers/usePersonalConversationTranscript'
import { getChatModelDisplayName } from '@/shared/ai/gateway/model-data'
import { createWebChatTranscriptAdapter } from './chat/toChatTranscriptView'
import {
  embeddedPersonalExchanges,
  type EmbeddedPendingSend,
  type EmbeddedPersonalExchange,
  type EmbeddedTurnEnd,
} from './chat/embedded-personal-transcript'

const EMBEDDED_PRESENTATION: Partial<ChatTranscriptPresentation> = {
  density: 'compact',
  showActions: false,
  showModelLabel: false,
}
const ignore = () => {}

/**
 * A personal conversation rendered in a narrow side panel with personal chat's own
 * exchange body and loading mark: live text, tool rows, interruption and failure.
 */
export function EmbeddedPersonalTranscript({ workspaceId, conversationId, canQuery, pendingSend, endedTurn, emptyState }: {
  workspaceId: string | null
  conversationId: string | null
  canQuery: boolean
  pendingSend: EmbeddedPendingSend | null
  endedTurn: EmbeddedTurnEnd | null
  emptyState: ReactNode
}) {
  const { transcript } = usePersonalConversationTranscript({ workspaceId, conversationId, canQuery, canRead: true })
  const toTranscriptView = useMemo(() => createWebChatTranscriptAdapter(), [])
  const exchanges = useMemo(
    () => embeddedPersonalExchanges({ rows: transcript.rows, pendingSend, endedTurn, toTranscriptView }),
    [endedTurn, pendingSend, toTranscriptView, transcript.rows],
  )
  if (exchanges.length === 0) return transcript.status === 'loading' ? null : emptyState
  return <EmbeddedPersonalTranscriptView exchanges={exchanges} />
}

export function EmbeddedPersonalTranscriptView({ exchanges }: { exchanges: readonly EmbeddedPersonalExchange[] }) {
  const view = useMemo(() => ({ version: 1 as const, exchanges: exchanges.map((entry) => entry.exchange) }), [exchanges])
  const actions = useMemo(() => {
    const byId = new Map(exchanges.map((entry) => [entry.exchange.id, entry]))
    return {
      renderExchange: (exchange: ChatTranscriptExchangeView, presentation: ChatTranscriptPresentation) => {
        const entry = byId.get(exchange.id)
        return entry ? <EmbeddedExchange entry={entry} presentation={presentation} /> : null
      },
    }
  }, [exchanges])

  return <ChatTranscript view={view} actions={actions} presentation={EMBEDDED_PRESENTATION} />
}

function EmbeddedExchange({ entry, presentation }: {
  entry: EmbeddedPersonalExchange
  presentation: ChatTranscriptPresentation
}) {
  const { exchange, responseInProgress, interrupted, errorMessage } = entry
  const response = exchange.responses[exchange.selectedResponseIndex]
  const blocks = response ? [...response.blocks] : []
  const hasText = blocks.some((block) => block.kind === 'text' && block.text.trim().length > 0)
  const modelId = response?.modelId ?? exchange.selectedModelId ?? ''
  return (
    <div data-exchange-turn={exchange.turnId}>
      <ChatExchange
        userMsgId={exchange.user.id}
        userBodyText={exchange.user.text}
        userDocumentNames={[...exchange.user.documentNames]}
        userImages={[...exchange.user.images]}
        userMentions={[...exchange.user.mentions]}
        exchIdx={exchange.index}
        responseModelId={modelId}
        assistantVisualBlocks={blocks}
        responseSources={response?.sources}
        sourceCitations={response?.sourceCitations}
        isStreaming={responseInProgress && blocks.length > 0}
        isTextStreaming={responseInProgress && hasText}
        errorMessage={errorMessage}
        responseInProgress={responseInProgress}
        status={exchange.status}
        interrupted={interrupted}
        turnIdForActions={exchange.turnId}
        modelLabel={modelId ? getChatModelDisplayName(modelId) : ''}
        onDeleteTurn={ignore}
        onReply={ignore}
        actionsLocked
        replyThreadMeta={null}
        onJumpToReply={ignore}
        onOpenDraft={ignore}
        onCreateAutomationDraft={ignore}
        isSourcesOpenForThis={false}
        generatedUiReadOnly
        presentation={presentation}
      />
    </div>
  )
}
