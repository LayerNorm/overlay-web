'use client'

import { useEffect, useRef } from 'react'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { ActivePublicStreamSnapshot } from '@/shared/chat/public-stream-projection'
import { withPosthog } from './posthog-client'

export function usePublicStreamMetrics(streams: readonly ActivePublicStreamSnapshot[]): void {
  const { capabilities } = useOverlayCapabilities()
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (!capabilities.analytics) return
    for (const stream of streams) {
      if (!stream.text) continue
      const key = JSON.stringify([stream.runId, stream.executionGeneration])
      if (seen.current.has(key)) continue
      seen.current.add(key)
      const receivedAt = performance.now()
      const properties = {
        run_id: stream.runId,
        generation: stream.executionGeneration,
        receipt_id: stream.receiptId,
        output_characters: stream.text.length,
        received_at_ms: Math.round(receivedAt),
      }
      withPosthog((posthog) => posthog.capture('harness_public_stream_first_live_text', properties))
      requestAnimationFrame(() => {
        const receiveToNextFrameMs = Math.round(performance.now() - receivedAt)
        withPosthog((posthog) => posthog.capture('harness_public_stream_next_frame', {
          ...properties,
          receive_to_next_frame_ms: receiveToNextFrameMs,
        }))
      })
    }
  }, [capabilities.analytics, streams])
}
