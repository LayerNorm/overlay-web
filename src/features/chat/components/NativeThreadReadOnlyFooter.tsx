'use client'

import { useState } from 'react'
import { Button, toast } from '@overlay/ui/primitives'
import type { NativeThreadSafety } from './chat/useNativeThreadSafety'

export function NativeThreadReadOnlyFooter({
  safety,
  onNewThread,
}: {
  safety: NativeThreadSafety
  onNewThread: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  if (!safety.readOnly) return null

  const startNewThread = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onNewThread()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start a new thread. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-4 py-4">
      <p role="status" className="text-center text-xs text-(--muted)">{safety.notice}</p>
      {safety.status === 'retired' ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void startNewThread() }}>
          New thread
        </Button>
      ) : safety.status !== 'checking' ? (
        <Button variant="outline" size="sm" onClick={() => { void safety.refresh() }}>Retry</Button>
      ) : null}
    </div>
  )
}
