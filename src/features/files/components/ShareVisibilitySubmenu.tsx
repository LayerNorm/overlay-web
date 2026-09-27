'use client'

import { Check, Globe, Loader2, Lock } from 'lucide-react'

/**
 * Shared "Private / Anyone with the link" picker used by the file and chat
 * export/share menus. Selecting public while already public re-opens the
 * share dialog instead of re-saving.
 */
export function ShareVisibilitySubmenu({
  shareVisibility,
  shareBusy,
  onUpdateVisibility,
  onOpenShareDialog,
}: {
  shareVisibility: 'private' | 'public'
  shareBusy: boolean
  onUpdateVisibility(next: 'private' | 'public'): void
  onOpenShareDialog(): void
}) {
  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-subtle)] py-1">
      <button
        type="button"
        onClick={() => onUpdateVisibility('private')}
        disabled={shareBusy}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors disabled:opacity-50"
      >
        <Lock size={14} />
        <span className="flex-1 text-left">Private</span>
        {shareVisibility === 'private' && <Check size={14} className="text-emerald-500" />}
      </button>
      <button
        type="button"
        onClick={() => {
          if (shareVisibility === 'public') {
            onOpenShareDialog()
            return
          }
          onUpdateVisibility('public')
        }}
        disabled={shareBusy}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors disabled:opacity-50"
      >
        {shareBusy && shareVisibility !== 'public' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Globe size={14} />
        )}
        <span className="flex-1 text-left">Anyone with the link</span>
        {shareVisibility === 'public' && <Check size={14} className="text-emerald-500" />}
      </button>
    </div>
  )
}
