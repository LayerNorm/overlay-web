'use client'
import { Button, FloatingMenu, MenuItem } from '@overlay/ui/primitives'

import type { ReactNode } from 'react'
import { useState, useRef } from 'react'
import {
  MoreHorizontal,
  Copy,
  FileDown,
  FileText,
  FileType2,
  FileJson,
  Check,
  Share2,
} from 'lucide-react'
import { useExport, type ExportFormat } from '@/features/files/hooks/useExport'
import type {
  ShareDialogRenderProps,
  ShareDialogResource,
} from '@/shared/share/share-dialog-resource'
import { ShareVisibilitySubmenu } from './ShareVisibilitySubmenu'

type ShareVisibility = 'private' | 'public'

const EXPORT_OPTIONS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: 'markdown', label: 'Markdown', icon: FileText },
  { format: 'pdf', label: 'PDF', icon: FileType2 },
  { format: 'docx', label: 'Word', icon: FileType2 },
  { format: 'json', label: 'JSON', icon: FileJson },
]

interface ExportMenuProps {
  type: 'chat' | 'note'
  title: string
  content: string | Array<{ role: string; content: string; parts?: Array<{ type: string; text?: string }> }>
  className?: string
  metadata?: {
    createdAt?: number
    updatedAt?: number
    modelIds?: string[]
  }
  /** Resource id used for sharing. When omitted, the Share row is hidden. */
  resourceId?: string
  initialShareVisibility?: 'private' | 'public'
  initialShareUrl?: string | null
  renderShareDialog: (props: ShareDialogRenderProps) => ReactNode
}

function useShareVisibility({
  type,
  title,
  resourceId,
  initialShareVisibility,
  initialShareUrl,
}: {
  type: 'chat' | 'note'
  title: string
  resourceId?: string
  initialShareVisibility?: ShareVisibility
  initialShareUrl?: string | null
}) {
  const [shareVisibility, setShareVisibility] = useState<ShareVisibility>(
    initialShareVisibility ?? 'private',
  )
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl ?? null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

  async function updateShareVisibility(next: ShareVisibility, onPublic?: () => void) {
    if (!resourceId || shareBusy) return
    setShareBusy(true)
    try {
      const endpoint =
        type === 'chat'
          ? '/api/v1/conversations/share'
          : '/api/v1/files/share'
      const idKey = type === 'chat' ? 'conversationId' : 'fileId'
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [idKey]: resourceId, visibility: next }),
      })
      if (!res.ok) throw new Error('Failed to update sharing')
      const data = (await res.json()) as {
        visibility: ShareVisibility
        url: string | null
      }
      setShareVisibility(data.visibility)
      setShareUrl(data.url)
      if (data.visibility === 'public') {
        onPublic?.()
        setShareDialogOpen(true)
      }
    } catch (error) {
      console.error('[ExportMenu] share', error)
    } finally {
      setShareBusy(false)
    }
  }

  const shareThumbnailUrl =
    shareUrl && shareUrl.endsWith('/')
      ? `${shareUrl}opengraph-image`
      : shareUrl
        ? `${shareUrl}/opengraph-image`
        : undefined

  const shareResource: ShareDialogResource | null = shareUrl
    ? {
        id: resourceId ?? '',
        type: type === 'chat' ? 'chat' : 'file',
        title: title || (type === 'chat' ? 'Shared chat' : 'Shared note'),
        url: shareUrl,
        thumbnailUrl: shareThumbnailUrl,
      }
    : null

  return {
    shareVisibility,
    shareBusy,
    shareDialogOpen,
    setShareDialogOpen,
    shareResource,
    updateShareVisibility,
  }
}

interface ExportMenuDropdownProps {
  copied: boolean
  onCopy: () => void
  showExportSubmenu: boolean
  onToggleExportSubmenu: () => void
  isExporting: boolean
  onExport: (format: ExportFormat) => void
  canShare: boolean
  shareVisibility: ShareVisibility
  shareBusy: boolean
  showShareSubmenu: boolean
  onToggleShareSubmenu: () => void
  onUpdateVisibility: (next: ShareVisibility) => void
  onOpenShareDialog: () => void
}

function ExportMenuDropdown({
  copied,
  onCopy,
  showExportSubmenu,
  onToggleExportSubmenu,
  isExporting,
  onExport,
  canShare,
  shareVisibility,
  shareBusy,
  showShareSubmenu,
  onToggleShareSubmenu,
  onUpdateVisibility,
  onOpenShareDialog,
}: ExportMenuDropdownProps) {
  return (
    <>
      <MenuItem
        type="button"
        onClick={onCopy}
        className="rounded-md"
      >
        {copied ? (
          <>
            <Check size={14} className="text-emerald-500" />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span>Copy as Markdown</span>
          </>
        )}
      </MenuItem>

      <MenuItem
        type="button"
        onClick={onToggleExportSubmenu}
        className="rounded-md"
      >
        <FileDown size={14} />
        <span>Export as...</span>
      </MenuItem>

      {showExportSubmenu && (
        <div className="pl-4">
          {EXPORT_OPTIONS.map(({ format, label, icon: Icon }) => (
            <MenuItem
              key={format}
              type="button"
              onClick={() => onExport(format)}
              disabled={isExporting}
              className="rounded-md"
            >
              <Icon size={14} />
              <span>{label}</span>
            </MenuItem>
          ))}
        </div>
      )}

      {canShare && (
        <>
          <MenuItem
            type="button"
            onClick={onToggleShareSubmenu}
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
              onUpdateVisibility={onUpdateVisibility}
              onOpenShareDialog={onOpenShareDialog}
            />
          )}
        </>
      )}
    </>
  )
}

export function ExportMenu({
  type,
  title,
  content,
  className = '',
  metadata,
  resourceId,
  initialShareVisibility,
  initialShareUrl,
  renderShareDialog,
}: ExportMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showExportSubmenu, setShowExportSubmenu] = useState(false)
  const [showShareSubmenu, setShowShareSubmenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { copyToClipboard, exportAs, isExporting } = useExport({
    type,
    title,
    content,
    metadata,
  })
  const {
    shareVisibility,
    shareBusy,
    shareDialogOpen,
    setShareDialogOpen,
    shareResource,
    updateShareVisibility,
  } = useShareVisibility({
    type,
    title,
    resourceId,
    initialShareVisibility,
    initialShareUrl,
  })

  const changeMenuOpen = (open: boolean) => {
    setShowMenu(open)
    if (open) return
    setShowExportSubmenu(false)
    setShowShareSubmenu(false)
  }

  const canShare = Boolean(resourceId)

  const closeShareMenus = () => {
    setShowMenu(false)
    setShowShareSubmenu(false)
  }

  const handleCopy = async () => {
    await copyToClipboard()
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      setShowMenu(false)
    }, 900)
  }

  const handleExport = async (format: ExportFormat) => {
    await exportAs(format)
    setShowMenu(false)
    setShowExportSubmenu(false)
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
            disabled={isExporting}
            aria-label="Export options"
            className="h-8 w-8 rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
          >
            <MoreHorizontal size={15} />
          </Button>
        }
      >
        <ExportMenuDropdown
          copied={copied}
          onCopy={handleCopy}
          showExportSubmenu={showExportSubmenu}
          onToggleExportSubmenu={() => setShowExportSubmenu(!showExportSubmenu)}
          isExporting={isExporting}
          onExport={handleExport}
          canShare={canShare}
          shareVisibility={shareVisibility}
          shareBusy={shareBusy}
          showShareSubmenu={showShareSubmenu}
          onToggleShareSubmenu={() => setShowShareSubmenu((v) => !v)}
          onUpdateVisibility={(next) => void updateShareVisibility(next, closeShareMenus)}
          onOpenShareDialog={() => {
            setShareDialogOpen(true)
            closeShareMenus()
          }}
        />
      </FloatingMenu>
      {renderShareDialog({
        isOpen: shareDialogOpen,
        onClose: () => setShareDialogOpen(false),
        resource: shareResource,
      })}
    </div>
  )
}
