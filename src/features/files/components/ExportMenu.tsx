'use client'

import type { ReactNode } from 'react'
import { useState, useRef, useEffect } from 'react'
import {
  MoreVertical,
  Copy,
  FileDown,
  FileText,
  FileType2,
  FileJson,
  Check,
  Share2,
  Lock,
  Globe,
  Loader2,
} from 'lucide-react'
import { useExport, type ExportFormat } from '@/features/files/hooks/useExport'
import type { ShareDialogRenderProps } from '@/shared/share/share-dialog-resource'

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
  const [shareVisibility, setShareVisibility] = useState<'private' | 'public'>(
    initialShareVisibility ?? 'private',
  )
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl ?? null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { copyToClipboard, exportAs, isExporting } = useExport({
    type,
    title,
    content,
    metadata,
  })

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
        setShowExportSubmenu(false)
        setShowShareSubmenu(false)
      }
    }

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  const canShare = Boolean(resourceId)

  async function updateShareVisibility(next: 'private' | 'public') {
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
        visibility: 'private' | 'public'
        url: string | null
      }
      setShareVisibility(data.visibility)
      setShareUrl(data.url)
      if (data.visibility === 'public') {
        setShowMenu(false)
        setShowShareSubmenu(false)
        setShareDialogOpen(true)
      }
    } catch (error) {
      console.error('[ExportMenu] share', error)
    } finally {
      setShareBusy(false)
    }
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

  const exportOptions: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
    { format: 'markdown', label: 'Markdown', icon: FileText },
    { format: 'pdf', label: 'PDF', icon: FileType2 },
    { format: 'docx', label: 'Word', icon: FileType2 },
    { format: 'json', label: 'JSON', icon: FileJson },
  ]

  const shareThumbnailUrl =
    shareUrl && shareUrl.endsWith('/')
      ? `${shareUrl}opengraph-image`
      : shareUrl
        ? `${shareUrl}/opengraph-image`
        : undefined

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        disabled={isExporting}
        className="inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-subtle)] text-[var(--muted)] transition-all duration-200 hover:bg-[var(--border)] hover:text-[var(--foreground)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Export options"
      >
        <MoreVertical size={16} strokeWidth={1.75} />
      </button>

      {showMenu && (
        <div className="overlay-pop-in absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
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
          </button>

          <div className="my-1 border-t border-[var(--border)]" />

          <button
            type="button"
            onClick={() => setShowExportSubmenu(!showExportSubmenu)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            <FileDown size={14} />
            <span>Export as...</span>
          </button>

          {showExportSubmenu && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-subtle)] py-1">
              {exportOptions.map(({ format, label, icon: Icon }) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => handleExport(format)}
                  disabled={isExporting}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors disabled:opacity-50"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}

          {canShare && (
            <>
              <div className="my-1 border-t border-[var(--border)]" />
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
            </>
          )}
        </div>
      )}
      {renderShareDialog({
        isOpen: shareDialogOpen,
        onClose: () => setShareDialogOpen(false),
        resource:
          shareUrl
            ? {
                type: type === 'chat' ? 'chat' : 'file',
                title: title || (type === 'chat' ? 'Shared chat' : 'Shared note'),
                url: shareUrl,
                thumbnailUrl: shareThumbnailUrl,
              }
            : null,
      })}
    </div>
  )
}
