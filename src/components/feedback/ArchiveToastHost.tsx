'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ARCHIVE_TOAST_EVENT, ARCHIVED_SETTINGS_HREF, type ArchiveToastDetail } from '@/shared/app/archive-toast'

const VISIBLE_MS = 8000

/**
 * The note that appears after anything is archived: what was archived, an Undo, and a link to Settings → Archived.
 * Archived items no longer have a row in every sidebar, so this is how a person finds them again straight away.
 */
export function ArchiveToastHost() {
  const [toast, setToast] = useState<ArchiveToastDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setToast(null)
    setFailed(false)
  }, [])

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ArchiveToastDetail>).detail
      if (!detail) return
      if (timer.current) clearTimeout(timer.current)
      setFailed(false)
      setToast(detail)
      timer.current = setTimeout(dismiss, VISIBLE_MS)
    }
    window.addEventListener(ARCHIVE_TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(ARCHIVE_TOAST_EVENT, onToast)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [dismiss])

  async function undo() {
    if (!toast?.undo) return
    setBusy(true)
    try {
      await toast.undo()
      toast.onUndone?.()
      dismiss()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (!toast) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[80] flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2 text-xs text-[var(--foreground)] shadow-lg"
    >
      <span className="min-w-0 truncate">
        {failed ? 'Could not undo that.' : (toast.summary ?? `Archived “${toast.name}”`)}
      </span>
      {toast.undo && !failed ? (
        <button type="button" disabled={busy} onClick={() => void undo()} className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50">
          Undo
        </button>
      ) : null}
      <Link href={ARCHIVED_SETTINGS_HREF} onClick={dismiss} className="shrink-0 text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline">
        View archived
      </Link>
    </div>
  )
}
