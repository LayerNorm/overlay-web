'use client'
import { unstyledButton } from '@overlay/ui/control-reset'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Toaster, toast, Button, IconButton } from '@overlay/ui/primitives'
import { ARCHIVE_TOAST_EVENT, ARCHIVED_SETTINGS_HREF, type ArchiveToastDetail } from '@/shared/app/archive-toast'

const VISIBLE_MS = 8000
const ARCHIVE_TOAST_ID = 'archive-toast'

export function ArchiveToastContent({ detail, dismiss }: { detail: ArchiveToastDetail; dismiss: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function undo() {
    if (!detail.undo) return
    setBusy(true)
    try {
      await detail.undo()
      detail.onUndone?.()
      dismiss()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="status" className="flex w-full flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 break-words">
        {failed ? 'Could not undo that.' : (detail.summary ?? `Archived “${detail.name}”`)}
      </span>
      {detail.undo && !failed ? (
        <Button variant="ghost" type="button" disabled={busy} onClick={() => void undo()} className={unstyledButton("shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50")}>
          Undo
        </Button>
      ) : null}
      <Link href={ARCHIVED_SETTINGS_HREF} onClick={dismiss} className="shrink-0 text-(--muted) underline-offset-2 hover:text-(--foreground) hover:underline">
        View archived
      </Link>
      <IconButton
        aria-label="Dismiss archive notification"
        title="Dismiss notification"
        size="sm"
        onClick={dismiss}
        className="shrink-0"
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  )
}

/**
 * The note that appears after anything is archived: what was archived, an Undo, and a link to Settings → Archived.
 * Archived items no longer have a row in every sidebar, so this is how a person finds them again straight away.
 */
export function ArchiveToastHost() {
  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ArchiveToastDetail>).detail
      if (!detail) return
      toast.custom(
        (id) => <ArchiveToastContent detail={detail} dismiss={() => toast.dismiss(id)} />,
        { id: ARCHIVE_TOAST_ID, duration: VISIBLE_MS },
      )
    }
    window.addEventListener(ARCHIVE_TOAST_EVENT, onToast)
    return () => window.removeEventListener(ARCHIVE_TOAST_EVENT, onToast)
  }, [])

  return <Toaster visibleToasts={3} />
}
