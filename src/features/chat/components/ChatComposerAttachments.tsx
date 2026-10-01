'use client'

import Image from 'next/image'
import { AlertCircle, FileText, X } from 'lucide-react'
import type { ChatComposerAttachmentState } from './ChatComposerTypes'

function fileTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : 'FILE'
}

function CircularProgressRing({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-5 w-5 shrink-0 animate-spin text-[var(--foreground)] ${className ?? ''}`}
      aria-hidden
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="13 37"
      />
    </svg>
  )
}

export function AttachmentPreviewTray({
  attachedImages,
  setAttachedImages,
  pendingChatDocuments,
  removePendingDocument,
  onOpenAttachmentPreview,
  onOpenFilePreview,
}: Pick<
  ChatComposerAttachmentState,
  | 'attachedImages'
  | 'setAttachedImages'
  | 'pendingChatDocuments'
  | 'removePendingDocument'
  | 'onOpenAttachmentPreview'
  | 'onOpenFilePreview'
>) {
  if (attachedImages.length === 0 && pendingChatDocuments.length === 0) return null

  return (
    <div className="mb-2 flex min-w-0 flex-wrap gap-2">
      {attachedImages.map((img, index) => (
        <div
          key={img.dataUrl}
          className="group relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] py-1.5 pl-1.5 pr-2 sm:max-w-[min(100%,240px)]"
        >
          <button
            type="button"
            onClick={() => onOpenAttachmentPreview({ name: img.name, content: img.dataUrl, url: img.dataUrl })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
            title="Open attachment"
          >
            <Image
              src={img.dataUrl}
              alt={img.name}
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 shrink-0 rounded-md border border-[var(--border)] object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--foreground)]">{img.name}</p>
              <p className="text-[10px] text-[var(--muted-light)]">Image</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setAttachedImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label={`Remove ${img.name}`}
          >
            <X size={10} strokeWidth={2} />
          </button>
        </div>
      ))}
      {pendingChatDocuments.map((doc) => (
        <div
          key={doc.clientId}
          className="group relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] py-1.5 pl-2 pr-2 sm:max-w-[min(100%,260px)]"
        >
          <button
            type="button"
            disabled={doc.status !== 'ready' || doc.fileIds.length === 0}
            onClick={() => void onOpenFilePreview(doc.name, doc.fileIds)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
            title={doc.status === 'ready' && doc.fileIds.length > 0 ? 'Open attachment' : undefined}
          >
            {doc.status === 'uploading' ? (
              <CircularProgressRing />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--muted)]">
                <FileText size={16} strokeWidth={1.75} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}</p>
              {doc.status === 'error' ? (
                <p className="truncate text-[10px] text-red-500" title={doc.error}>
                  {doc.error ?? 'Failed'}
                </p>
              ) : (
                <p className="text-[10px] text-[var(--muted-light)]">{fileTypeLabel(doc.name)}</p>
              )}
            </div>
          </button>
          <button
            type="button"
            onClick={() => removePendingDocument(doc.clientId)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label={`Remove ${doc.name}`}
          >
            <X size={10} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ComposerAlerts({
  attachmentError,
  composerNotice,
}: {
  attachmentError: string | null
  composerNotice: string | null
}) {
  const alert = attachmentError ?? composerNotice
  if (!alert) return null
  const error = Boolean(attachmentError)
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs"
      style={{
        background: error ? 'var(--chat-alert-error-bg)' : 'var(--chat-alert-warn-bg)',
        borderColor: error ? 'var(--chat-alert-error-border)' : 'var(--chat-alert-warn-border)',
        color: error ? 'var(--chat-alert-error-text)' : 'var(--chat-alert-warn-text)',
      }}
    >
      <AlertCircle size={13} className="shrink-0 opacity-80" />
      {alert}
    </div>
  )
}
