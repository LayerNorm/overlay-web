'use client'

import { useEffect } from 'react'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { withPosthog } from '@/components/providers/posthog-client'
import {
  FIRST_REPLY_EVENT,
  firstReplyTracker,
  type FirstReplyProperties,
  type FirstReplyTracker,
  type FirstReplyView,
} from '@/shared/chat/first-reply-timing'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

function sendFirstReply(properties: FirstReplyProperties) {
  withPosthog((posthog) => posthog.capture(FIRST_REPLY_EVENT, properties))
}

/**
 * Sends one `chat_first_text_visible` event per measured turn, from the effect after
 * the render that first shows its text. Effects run once React commits that render,
 * usually after paint, so the time is a proxy for visibility, not a measured paint.
 */
export function useFirstReplyMetric({
  shownConversationId,
  native,
  sdk,
  tracker = firstReplyTracker,
  send = sendFirstReply,
}: {
  shownConversationId: string | null
  native: FirstReplyView['native']
  sdk: FirstReplyView['sdk']
  tracker?: FirstReplyTracker
  send?: (properties: FirstReplyProperties) => void
}) {
  const { capabilities } = useOverlayCapabilities()
  const analytics = capabilities.analytics

  useEffect(() => {
    const markHidden = () => {
      if (document.visibilityState === 'hidden') tracker.markHidden()
    }
    document.addEventListener('visibilitychange', markHidden)
    return () => document.removeEventListener('visibilitychange', markHidden)
  }, [tracker])

  useEffect(() => {
    if (tracker.pendingCount() === 0) return
    const shown = shownConversationId === PENDING_FIRST_CHAT_ID ? null : shownConversationId
    const ready = tracker.observe(shown, { native, sdk }, performance.now())
    if (!analytics) return
    for (const properties of ready) send(properties)
  }, [analytics, native, sdk, send, shownConversationId, tracker])
}
