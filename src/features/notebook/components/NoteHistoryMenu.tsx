'use client'

import { useEffect, useRef, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { NoteVersion } from '@overlay/app-core'

function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function NoteHistoryMenu({
  noteId,
  onRestore,
}: {
  noteId: string
  onRestore(version: NoteVersion): void
}) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<NoteVersion[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    overlayAppClient.notes
      .listVersions({ noteId })
      .then((list) => {
        if (!cancelled) setVersions(list ?? [])
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, noteId])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Note history"
        title="Version history"
        onClick={() => {
          setVersions(null)
          setOpen((value) => !value)
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      >
        <History size={16} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
            Version history
          </div>
          <div className="max-h-72 overflow-y-auto">
            {versions === null ? (
              <div className="px-3 py-4 text-xs text-[var(--muted)]">Loading…</div>
            ) : versions.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[var(--muted)]">
                No earlier versions yet.
              </div>
            ) : (
              versions.map((version) => (
                <div
                  key={version._id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[var(--surface-subtle)]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--foreground)]">
                      {version.name || 'Untitled'}
                    </div>
                    <div className="text-[var(--muted)]">
                      {timeAgo(version.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--foreground)] hover:bg-[var(--surface)]"
                    onClick={() => {
                      onRestore(version)
                      setOpen(false)
                    }}
                  >
                    <RotateCcw size={11} strokeWidth={1.8} />
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
