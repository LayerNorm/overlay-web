import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'
import React from 'react'
import { WorkingLine, hasRunningTool } from '../exchange/working-orb'

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
 * The one rule every live reply uses for its working state: chat exchanges, agent
 * threads and rooms. An in-progress reply without an explicit status is
 * `submitted` until it has blocks and `streaming` after; the mark stays through
 * tool-only periods (on the running tool's row) and disappears once the reply settles.
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

/**
 * The bottom of a live response between tool calls: a working orb and what the agent is doing ("Thinking",
 * "Writing the reply"). While a tool runs, that tool's row carries the orb instead, so nothing shows here.
 */
export function ExchangeLoadingState({
  presentation,
  blocks = [],
}: {
  presentation: ExchangeLoadingPresentation
  blocks?: readonly AssistantVisualBlock[]
}) {
  if (!presentation.active || presentation.marker === 'none' || hasRunningTool(blocks)) return null
  return <WorkingLine blocks={blocks} />
}
