import { Fragment, type ReactNode } from 'react'
import type { ChatTranscriptExchangeView, ChatTranscriptView } from '@overlay/chat-core'
import { recordRender } from '../../lib/perf-debug'

function dayKey(timestamp: number | undefined): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface ChatTranscriptPresentation {
  density: 'comfortable' | 'compact'
  actionVisibility: 'always' | 'hover'
  showActions: boolean
  showModelLabel: boolean
  maxContentWidth: string
}
export const DEFAULT_CHAT_TRANSCRIPT_PRESENTATION: ChatTranscriptPresentation = {
  density: 'comfortable',
  actionVisibility: 'hover',
  showActions: true,
  showModelLabel: true,
  maxContentWidth: '56rem',
}

/**
 * P6 intentionally changes these web behaviors. Keeping the approved Class B
 * differences beside the default presentation makes later parity work fail
 * loudly if somebody treats them as accidental screenshot drift.
 */
export const APPROVED_CLASS_B_WEB_DIFFERENCES = [
  {
    id: 'exchange-actions-hover-focus',
    before: 'Completed exchange actions were always visible.',
    after: 'Actions reveal on hover or focus-within, with a coarse-pointer fallback.',
  },
  {
    id: 'status-driven-loading',
    before: 'Loading markers were selected from host-specific booleans.',
    after: 'Loading presentation follows the normalized selected-response status.',
  },
  {
    id: 'intent-preserving-autoscroll',
    before: 'Streaming growth could pull the viewport back toward the composer.',
    after: 'A submitted turn is aligned near the top once; streaming then grows without moving the viewport.',
  },
] as const

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

  // Slack/room-style day dividers between personal-chat exchanges when the
  // user turn carries a createdAt. Missing timestamps skip the divider.
  return view.exchanges.map((exchange, index) => {
    const previous = index > 0 ? view.exchanges[index - 1] : undefined
    const currentKey = dayKey(exchange.user.createdAt)
    const previousKey = dayKey(previous?.user.createdAt)
    const showDayDivider = Boolean(
      currentKey
      && exchange.user.createdAt
      && (!previous || !previousKey || previousKey !== currentKey),
    )
    return (
      <Fragment key={exchange.id}>
        {showDayDivider ? (
          <div
            className="flex items-center gap-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]"
            data-testid="chat-day-divider"
          >
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span>{dayLabel(exchange.user.createdAt!)}</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        ) : null}
        {actions.renderExchange(exchange, resolvedPresentation)}
      </Fragment>
    )
  })
}
