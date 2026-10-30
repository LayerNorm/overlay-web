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
