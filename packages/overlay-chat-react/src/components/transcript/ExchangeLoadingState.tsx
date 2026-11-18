import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'
import { OverlayMark } from '@overlay/ui'
import React from 'react'

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
  _blocks: readonly AssistantVisualBlock[],
): ExchangeLoadingPresentation {
  void _blocks
  const active = ACTIVE_EXCHANGE_STATUSES.has(status)
  return { active, inlineTextMarker: false, marker: active ? 'standalone' : 'none' }
}

/**
 * The one rule every live reply uses for its loading mark: chat exchanges, agent
 * threads and rooms. An in-progress reply without an explicit status is
 * `submitted` until it has blocks and `streaming` after; the mark stays through
 * tool-only periods and disappears once the reply settles.
 */
export function responseLoadingPresentation(
  status: ChatExchangeStatus | undefined,
  responseInProgress: boolean | undefined,
  blocks: readonly AssistantVisualBlock[],
) {
  const liveStatus: ChatExchangeStatus = responseInProgress
    ? (blocks.length > 0 ? 'streaming' : 'submitted')
    : 'completed'
  const normalizedStatus = responseInProgress && (status === undefined || status === 'completed')
    ? liveStatus
    : status ?? liveStatus
  const loadingPresentation = exchangeLoadingPresentation(normalizedStatus, blocks)
  return { loadingPresentation, responseSettled: !loadingPresentation.active }
}

export function ExchangeLoadingState({
  presentation,
}: {
  presentation: ExchangeLoadingPresentation
}) {
  if (!presentation.active || presentation.marker === 'none') return null
  return (
    <div
      className="flex items-center px-1 py-1 text-(--muted)"
      aria-live="polite"
      aria-busy="true"
      aria-label="Overlay is responding"
      role="status"
      data-loading-presentation="standalone"
    >
      <OverlayMark motion="look" size={24} label="" />
    </div>
  )
}
