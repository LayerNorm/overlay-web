'use client'

import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import type { AttachmentDraft } from '@overlay/chat-core'

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function formatSize(sizeBytes?: number): string {
  if (!sizeBytes) return ''
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentTray({
  attachments,
  onRemoveAttachment,
}: {
  attachments: AttachmentDraft[]
  onRemoveAttachment: (id: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--foreground)]"
        >
          {attachment.kind === 'image' && attachment.dataUrl ? (
            <img src={attachment.dataUrl} alt="" className="h-5 w-5 rounded object-cover" />
          ) : isImageMime(attachment.mimeType) ? (
            <ImageIcon size={12} strokeWidth={1.75} />
          ) : (
            <FileText size={12} strokeWidth={1.75} />
          )}
          <span className="max-w-[10rem] truncate">{attachment.name}</span>
          {attachment.status === 'uploading' ? (
            <Loader2 size={11} className="animate-spin text-[var(--muted)]" />
          ) : attachment.status === 'error' ? (
            <span className="text-[var(--chat-alert-error-text)]">!</span>
          ) : attachment.sizeBytes ? (
            <span className="text-[var(--muted)]">{formatSize(attachment.sizeBytes)}</span>
          ) : null}
          <button
            type="button"
            onClick={() => onRemoveAttachment(attachment.id)}
            className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            aria-label={`Remove ${attachment.name}`}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  )
}
