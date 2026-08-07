'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Check, Globe, Loader2, Lock, MoreVertical, Share2 } from 'lucide-react'
import { buildSharePageUrl } from '@/shared/share/share-page-url'
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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
        setShowShareSubmenu(false)
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

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
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        className="rounded-md p-1.5 text-[var(--muted)] transition-all duration-200 hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90"
        aria-label="More options"
      >
        <MoreVertical size={16} strokeWidth={1.75} />
      </button>

      {showMenu && (
        <div className="overlay-pop-in absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <button
            type="button"
            onClick={() => setShowShareSubmenu((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            <Share2 size={14} />
            <span>Share</span>
            {shareVisibility === 'public' && (
              <span className="ml-auto text-[10px] font-medium text-emerald-500">On</span>
            )}
          </button>
          {showShareSubmenu && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-subtle)] py-1">
              <button
                type="button"
                onClick={() => void updateShareVisibility('private')}
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
                    setShareDialogOpen(true)
                    setShowMenu(false)
                    setShowShareSubmenu(false)
                    return
                  }
                  void updateShareVisibility('public')
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
          )}
        </div>
      )}

      {renderShareDialog({
        isOpen: shareDialogOpen,
        onClose: () => setShareDialogOpen(false),
        resource:
          shareUrl
            ? { type: 'file', title: title || 'Shared file', url: shareUrl }
            : null,
      })}
    </div>
  )
}
