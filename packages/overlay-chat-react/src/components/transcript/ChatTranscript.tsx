import { Fragment, type ReactNode } from 'react'
import type { ChatTranscriptExchangeView, ChatTranscriptView } from '@overlay/chat-core'
import { recordRender } from '../../lib/perf-debug'

export interface ChatTranscriptPresentation {
  density: 'comfortable' | 'compact'
  actionVisibility: 'always' | 'hover'
  showModelLabel: boolean
  maxContentWidth: string
}

export const DEFAULT_CHAT_TRANSCRIPT_PRESENTATION: ChatTranscriptPresentation = {
  density: 'comfortable',
  actionVisibility: 'always',
  showModelLabel: true,
  maxContentWidth: '56rem',
}

/**
 * Compatibility rendering bridge for platform actions. The normalized view
 * owns exchange identity/order while each host supplies its existing action
 * bindings until action behavior converges in the next parity phase.
 */
export interface ChatTranscriptActions {
  renderExchange: (
    exchange: ChatTranscriptExchangeView,
    presentation: ChatTranscriptPresentation,
  ) => ReactNode
}

export interface ChatTranscriptProps {
  view: ChatTranscriptView
  actions: ChatTranscriptActions
  presentation?: Partial<ChatTranscriptPresentation>
}

export function ChatTranscript({
  view,
  actions,
  presentation,
}: ChatTranscriptProps) {
  recordRender('ChatTranscript')
  const resolvedPresentation = presentation
    ? { ...DEFAULT_CHAT_TRANSCRIPT_PRESENTATION, ...presentation }
    : DEFAULT_CHAT_TRANSCRIPT_PRESENTATION

  return view.exchanges.map((exchange) => (
    <Fragment key={exchange.id}>
      {actions.renderExchange(exchange, resolvedPresentation)}
    </Fragment>
  ))
}
