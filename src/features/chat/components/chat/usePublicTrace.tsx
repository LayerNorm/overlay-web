'use client'

import { useEffect, useMemo, useState } from 'react'
import { normalizeTranscriptAssistantParts, type AssistantVisualBlock } from '@overlay/chat-core'
import { Button } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { readPublicTrace, type PublicTrace } from './public-trace'

type TraceState = { messageId: string; status: 'error' | 'ready'; trace?: PublicTrace | null }

export function usePublicTrace({ messageId, enabled, blocks, terminalState = 'completed' }: {
  messageId?: string | null
  enabled: boolean
  blocks: AssistantVisualBlock[]
  terminalState?: 'completed' | 'error' | 'cancelled' | 'interrupted'
}) {
  const [expanded, setExpanded] = useState(false)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<TraceState | null>(null)
  const loaded = state?.messageId === messageId && state?.status === 'ready'
  useEffect(() => {
    if (!expanded || !enabled || !messageId || loaded) return
    const controller = new AbortController()
    void overlayAppClient.request(`/api/v1/conversations/trace?messageId=${encodeURIComponent(messageId)}`, {
      signal: controller.signal,
    }).then(readPublicTrace).then(trace => {
      if (!controller.signal.aborted) setState({ messageId, status: 'ready', trace })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ messageId, status: 'error' })
    })
    return () => controller.abort()
  }, [enabled, expanded, messageId, loaded, retry])

  const normalized = useMemo(() => normalizeTranscriptAssistantParts(state?.trace?.parts, { terminalState }), [state?.trace, terminalState])
  const full = expanded && enabled && loaded && normalized.blocks.length > 0
  const currentUi = new Map(blocks.flatMap(block => block.kind === 'generated-ui' ? [[block.part.id, block] as const] : []))
  const fullBlocks = normalized.blocks.map(block => block.kind === 'generated-ui' ? currentUi.get(block.part.id) ?? block : block)
  const supplemental = blocks.filter(block => (
    block.kind === 'source' && !fullBlocks.some(fullBlock => fullBlock.kind === 'source' && fullBlock.id === block.id)
    || block.kind === 'file' && !fullBlocks.some(fullBlock => fullBlock.kind === 'file' && fullBlock.url === block.url)
    || block.kind === 'generated-ui' && !fullBlocks.some(fullBlock => fullBlock.kind === 'generated-ui' && fullBlock.part.id === block.part.id)
  ))
  const currentState = state?.messageId === messageId ? state : null
  const workDetails = !expanded || !enabled || !messageId
    ? null
    : !loaded && currentState?.status !== 'error'
      ? <p role="status" className="text-xs text-(--muted)">Loading full trace…</p>
      : currentState?.status === 'error'
        ? <p role="status" className="text-xs text-(--muted)">Could not load the full trace.{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setRetry(value => value + 1)}>Retry</Button>
        </p>
        : full && state?.trace?.legacy
          ? <p className="text-xs text-(--muted)">Historical tool payloads may be truncated.</p>
          : null
  return {
    blocks: full ? [...fullBlocks, ...supplemental] : blocks,
    sources: full ? normalized.sources : undefined,
    onWorkExpandedChange: setExpanded,
    workDetails,
  }
}
