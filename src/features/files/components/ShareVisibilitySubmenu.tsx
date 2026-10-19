'use client'
import { MenuItem } from '@overlay/ui/primitives'

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
    <div className="pl-4">
      <MenuItem
        type="button"
        onClick={() => onUpdateVisibility('private')}
        disabled={shareBusy}
        className="rounded-md"
      >
        <Lock size={14} />
        <span className="flex-1 text-left">Private</span>
        {shareVisibility === 'private' && <Check size={14} className="text-emerald-500" />}
      </MenuItem>
      <MenuItem
        type="button"
        onClick={() => {
          if (shareVisibility === 'public') {
            onOpenShareDialog()
            return
          }
          onUpdateVisibility('public')
        }}
        disabled={shareBusy}
        className="rounded-md"
      >
        {shareBusy && shareVisibility !== 'public' ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Globe size={14} />
        )}
        <span className="flex-1 text-left">Anyone with the link</span>
        {shareVisibility === 'public' && <Check size={14} className="text-emerald-500" />}
      </MenuItem>
    </div>
  )
}
