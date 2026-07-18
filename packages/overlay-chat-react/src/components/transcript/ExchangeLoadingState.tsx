import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'

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
      className={`flex items-center px-1 ${compact ? 'min-h-5 py-1' : 'min-h-7 py-2'}`}
      aria-live="polite"
      aria-busy="true"
      data-loading-presentation={presentation.marker}
    >
      <span
        className={`overlay-stream-marker overlay-stream-marker--standalone${compact ? ' scale-75 opacity-80' : ''}`}
        aria-label={compact ? 'Response still generating' : 'Response loading'}
        role="img"
      />
    </div>
  )
}
