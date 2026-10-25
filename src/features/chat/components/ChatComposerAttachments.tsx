'use client'

import Image from 'next/image'
import { FileText, X } from 'lucide-react'
import { Button, toast } from '@overlay/ui/primitives'
import { useEffect } from 'react'
import type { ChatComposerAttachmentState } from './ChatComposerTypes'

function fileTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : 'FILE'
}

function CircularProgressRing({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-5 w-5 shrink-0 animate-spin text-(--foreground) ${className ?? ''}`}
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
          className="group relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-(--border) bg-(--surface-subtle) py-1.5 pl-1.5 pr-2 sm:max-w-[min(100%,240px)]"
        >
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenAttachmentPreview({ name: img.name, content: img.dataUrl, url: img.dataUrl })}
            className="h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-left font-normal outline-hidden transition-opacity hover:bg-transparent hover:text-current hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-elevated)"
            title="Open attachment"
          >
            <Image
              src={img.dataUrl}
              alt={img.name}
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 shrink-0 rounded-md border border-(--border) object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-(--foreground)">{img.name}</p>
              <p className="text-[10px] text-(--muted-light)">Image</p>
            </div>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => setAttachedImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            className="h-5 w-5 shrink-0 rounded-full border border-(--border) bg-(--surface-elevated) p-0 text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
            aria-label={`Remove ${img.name}`}
          >
            <X size={10} strokeWidth={2} />
          </Button>
        </div>
      ))}
      {pendingChatDocuments.map((doc) => (
        <div
          key={doc.clientId}
          className="group relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-(--border) bg-(--surface-subtle) py-1.5 pl-2 pr-2 sm:max-w-[min(100%,260px)]"
        >
          <Button
            variant="ghost"
            type="button"
            disabled={doc.status !== 'ready' || doc.fileIds.length === 0}
            onClick={() => void onOpenFilePreview(doc.name, doc.fileIds)}
            className="h-auto min-w-0 flex-1 justify-start gap-2.5 p-0 text-left font-normal hover:bg-transparent hover:text-current disabled:cursor-default"
            title={doc.status === 'ready' && doc.fileIds.length > 0 ? 'Open attachment' : undefined}
          >
            {doc.status === 'uploading' ? (
              <CircularProgressRing />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center text-(--muted)">
                <FileText size={16} strokeWidth={1.75} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-(--foreground)">{doc.name}</p>
              {doc.status === 'error' ? (
                <p className="truncate text-[10px] text-red-500" title={doc.error}>
                  {doc.error ?? 'Failed'}
                </p>
              ) : (
                <p className="text-[10px] text-(--muted-light)">{fileTypeLabel(doc.name)}</p>
              )}
            </div>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => removePendingDocument(doc.clientId)}
            className="h-5 w-5 shrink-0 rounded-full border border-(--border) bg-(--surface-elevated) p-0 text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
            aria-label={`Remove ${doc.name}`}
          >
            <X size={10} strokeWidth={2} />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function useComposerAlertToasts(
  composerNotice: string | null,
  attachmentError: string | null,
) {
  useEffect(() => {
    if (composerNotice) toast.warning(composerNotice, { id: 'composer-notice' })
    else toast.dismiss('composer-notice')
  }, [composerNotice])

  useEffect(() => {
    if (attachmentError) toast.error(attachmentError, { id: 'composer-attachment-error' })
    else toast.dismiss('composer-attachment-error')
  }, [attachmentError])
}
