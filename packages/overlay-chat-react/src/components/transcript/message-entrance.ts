'use client'

import { useState } from 'react'

const RECENT_MESSAGE_MS = 5000

/** True when a message was created moments ago, so it is arriving live rather than loading as history. */
export function isRecentMessage(createdAt: number | undefined): boolean {
  return typeof createdAt === 'number' && Date.now() - createdAt < RECENT_MESSAGE_MS
}

/**
 * Returns the `message-appear` entrance class only for rows that are new when they
 * mount (a sent message, a streaming reply). Opening a thread mounts its whole history
 * at once; replaying the entrance on every row there makes thread switches feel slow.
 * The decision is frozen at mount so a row never re-animates when its props change.
 */
export function useMessageEntrance(liveAtMount: boolean): string {
  const [entering] = useState(liveAtMount)
  return entering ? 'message-appear' : ''
}
