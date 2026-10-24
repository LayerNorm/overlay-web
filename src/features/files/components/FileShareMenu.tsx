'use client'
import { Button, FloatingMenu, MenuItem } from '@overlay/ui/primitives'

import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { MoreHorizontal, Share2 } from 'lucide-react'
import { buildSharePageUrl } from '@/shared/share/share-page-url'
import { ShareVisibilitySubmenu } from './ShareVisibilitySubmenu'
import type { ShareDialogRenderProps } from '@/shared/share/share-dialog-resource'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

interface FileShareMenuProps {
  fileId: string
  title: string
  initialShareVisibility?: 'private' | 'public'
  initialShareUrl?: string | null
  className?: string
  renderShareDialog: (props: ShareDialogRenderProps) => ReactNode
}

/** Minimal 3-dot menu surfaced on file viewers. Currently only exposes Share. */
export function FileShareMenu({
  fileId,
  title,
  initialShareVisibility,
  initialShareUrl,
  className = '',
  renderShareDialog,
}: FileShareMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showShareSubmenu, setShowShareSubmenu] = useState(false)
  const [shareVisibility, setShareVisibility] = useState<'private' | 'public'>(
    initialShareVisibility ?? 'private',
  )
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl ?? null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const changeMenuOpen = (open: boolean) => {
    setShowMenu(open)
    if (!open) setShowShareSubmenu(false)
  }

  async function updateShareVisibility(next: 'private' | 'public') {
    if (shareBusy) return
    setShareBusy(true)
    try {
      const res = await overlayAppClient.files.shareResponse({ fileId, visibility: next })
      if (!res.ok) throw new Error('Failed to update sharing')
      const data = (await res.json()) as {
        visibility: 'private' | 'public'
        token: string | null
        url: string | null
      }
      setShareVisibility(data.visibility)
      const url = data.url ?? buildSharePageUrl('file', data.token)
      setShareUrl(url)
      if (data.visibility === 'public') {
        setShowMenu(false)
        setShowShareSubmenu(false)
        setShareDialogOpen(true)
      }
    } catch (error) {
      console.error('[FileShareMenu] share', error)
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <div className={className}>
      <FloatingMenu
        anchorRef={triggerRef}
        open={showMenu}
        onOpenChange={changeMenuOpen}
        align="end"
        className="w-48 p-1"
        trigger={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            type="button"
            aria-label="More options"
            className="h-8 w-8 rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
          >
            <MoreHorizontal size={15} />
          </Button>
        }
      >
        <MenuItem
          type="button"
          onClick={() => setShowShareSubmenu((v) => !v)}
          className="rounded-md"
        >
          <Share2 size={14} />
          <span>Share</span>
          {shareVisibility === 'public' && (
            <span className="ml-auto text-[10px] font-medium text-emerald-500">On</span>
          )}
        </MenuItem>
        {showShareSubmenu && (
          <ShareVisibilitySubmenu
            shareVisibility={shareVisibility}
            shareBusy={shareBusy}
            onUpdateVisibility={(next) => void updateShareVisibility(next)}
            onOpenShareDialog={() => {
              setShareDialogOpen(true)
              setShowMenu(false)
              setShowShareSubmenu(false)
            }}
          />
        )}
      </FloatingMenu>

      {renderShareDialog({
        isOpen: shareDialogOpen,
        onClose: () => setShareDialogOpen(false),
        resource:
          shareUrl
            ? { id: fileId, type: 'file', title: title || 'Shared file', url: shareUrl }
            : null,
      })}
    </div>
  )
}
