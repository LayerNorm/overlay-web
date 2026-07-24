import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'
import React from 'react'
import { ToolLineLogo } from '../exchange/tool-rail'

export const EXCHANGE_LOADING_LABELS = [
  'Thinking',
  'Contemplating',
  'Comprehending',
  'Reasoning',
  'Pondering',
  'Considering',
] as const

const ACTIVE_EXCHANGE_STATUSES = new Set<ChatExchangeStatus>([
  'submitted',
  'streaming',
  'awaiting-approval',
  'executing-tool',
])

export interface ExchangeLoadingPresentation {
  active: boolean
  inlineTextMarker: boolean
  marker: 'none' | 'standalone' | 'compact'
}

export function exchangeLoadingPresentation(
  status: ChatExchangeStatus,
  blocks: readonly AssistantVisualBlock[],
): ExchangeLoadingPresentation {
  const active = ACTIVE_EXCHANGE_STATUSES.has(status)
  if (!active) return { active: false, inlineTextMarker: false, marker: 'none' }
  if (blocks.length === 0) {
    return { active: true, inlineTextMarker: false, marker: 'standalone' }
  }

  const lastBlock = blocks[blocks.length - 1]
  if (status === 'streaming' && lastBlock?.kind === 'text') {
    return { active: true, inlineTextMarker: true, marker: 'none' }
  }
  if (status === 'executing-tool' || status === 'awaiting-approval') {
    return { active: true, inlineTextMarker: false, marker: 'none' }
  }
  return { active: true, inlineTextMarker: false, marker: 'compact' }
}

export function ExchangeLoadingState({
  presentation,
}: {
  presentation: ExchangeLoadingPresentation
}) {
  if (presentation.marker === 'none') return null
  const compact = presentation.marker === 'compact'
  return (
    <div
      className={`flex px-1 ${compact ? 'min-h-5 items-center py-1' : 'items-stretch gap-2.5 py-1 text-[13px] leading-snug'}`}
      aria-live="polite"
      aria-busy="true"
      aria-label={compact ? 'Response still generating' : 'Thinking'}
      role="status"
      data-loading-presentation={presentation.marker}
    >
      {compact ? (
        <span
          className="overlay-stream-marker overlay-stream-marker--standalone scale-75 opacity-80"
          aria-hidden="true"
        />
      ) : (
        <>
          <span className="overlay-loading-tool-logo" aria-hidden="true">
            <ToolLineLogo />
          </span>
          <span className="overlay-loading-word-viewport" aria-hidden="true">
            <span className="overlay-loading-word-track">
              {[...EXCHANGE_LOADING_LABELS, EXCHANGE_LOADING_LABELS[0]].map((label, index) => (
                <span className="overlay-loading-word tool-line-shimmer" key={`${label}-${index}`}>
                  {label}
                </span>
              ))}
            </span>
          </span>
        </>
      )}
    </div>
  )
}
