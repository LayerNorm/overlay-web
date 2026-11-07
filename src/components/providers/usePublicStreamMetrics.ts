'use client'

import { useEffect, useRef } from 'react'
import posthog from 'posthog-js'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { ActivePublicStreamSnapshot } from '@/shared/chat/public-stream-projection'

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
      try {
        posthog.capture('harness_public_stream_first_live_text', properties)
      } catch {
        continue
      }
      requestAnimationFrame(() => {
        try {
          posthog.capture('harness_public_stream_first_paint', {
            ...properties,
            receive_to_paint_ms: Math.round(performance.now() - receivedAt),
          })
        } catch {
          return
        }
      })
    }
  }, [capabilities.analytics, streams])
}
