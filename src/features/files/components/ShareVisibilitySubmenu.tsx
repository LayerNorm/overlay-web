'use client'
import { unstyledButton } from '../../control-reset'
import { Button } from '@overlay/ui/primitives'

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
    <div className="border-t border-(--border) bg-(--surface-subtle) py-1">
      <Button variant="ghost"
        type="button"
        onClick={() => onUpdateVisibility('private')}
        disabled={shareBusy}
        className={unstyledButton(`flex w-full items-center gap-2 px-3 py-2 text-xs text-(--foreground) hover:bg-(--surface-muted) transition-colors disabled:opacity-50`)}
      >
        <Lock size={14} />
        <span className="flex-1 text-left">Private</span>
        {shareVisibility === 'private' && <Check size={14} className="text-emerald-500" />}
      </Button>
      <Button variant="ghost"
        type="button"
        onClick={() => {
          if (shareVisibility === 'public') {
            onOpenShareDialog()
            return
          }
          onUpdateVisibility('public')
        }}
        disabled={shareBusy}
        className={unstyledButton(`flex w-full items-center gap-2 px-3 py-2 text-xs text-(--foreground) hover:bg-(--surface-muted) transition-colors disabled:opacity-50`)}
      >
        {shareBusy && shareVisibility !== 'public' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Globe size={14} />
        )}
        <span className="flex-1 text-left">Anyone with the link</span>
        {shareVisibility === 'public' && <Check size={14} className="text-emerald-500" />}
      </Button>
    </div>
  )
}
