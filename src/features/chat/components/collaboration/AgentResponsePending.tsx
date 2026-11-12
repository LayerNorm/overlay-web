'use client'

import { useState } from 'react'
import type { RoomMessageView } from './RoomMessageItem'

/** Keyed by the response row so pauses between model/tool steps cannot restart it. */
export function AgentResponsePending({ message }: { message: RoomMessageView }) {
  const hasText = message.blocks.some(block => block.kind === 'text' && block.text.trim().length > 0)
  const [started, setStarted] = useState(hasText)
  if (hasText && !started) setStarted(true)
  if (started || hasText || !message.streaming || message.generationError
    || message.nativeApproval || message.nativeInput || message.remoteRequest
    || ['cancelled', 'cancelling', 'failed', 'completed', 'recoverable'].includes(message.remoteRun?.state ?? '')) return null
  return <div className="agent-response-pending" role="status" aria-label={`${message.authorName} is preparing a response`}>
    <span /><span /><span />
  </div>
}
