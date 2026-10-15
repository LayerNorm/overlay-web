'use client'

import { useEffect } from 'react'

/**
 * Page loads cannot re-mint the session cookie (RSC has no response headers),
 * so the console touches once on mount to roll the 30-minute idle window and
 * persist any refreshed WorkOS tokens.
 */
export function SessionTouch() {
  useEffect(() => {
    void fetch('/auth/touch', { credentials: 'same-origin', method: 'POST' }).catch(() => undefined)
  }, [])
  return null
}
