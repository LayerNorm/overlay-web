'use client'

import NextImage from 'next/image'
import { File, FileText, Film, Image as ImageIcon } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { useRouter } from 'next/navigation'
import { useConversationFiles } from '@/hooks/use-file-tree'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'

export function AgentLibraryTab({
  conversationId,
  onOpenFile,
}: {
  conversationId: string
  onOpenFile?: (file: NonNullable<ReturnType<typeof useConversationFiles>>[number]) => void
}) {
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const files = useConversationFiles(conversationId)
  if (files === null) return <p className="py-2 text-xs text-(--muted)">Could not load files.</p>
  if (!files) return <p className="py-2 text-xs text-(--muted)">Loading files...</p>
  const threadFiles = files
  if (threadFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <p className="text-xs text-(--muted)">No files yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {threadFiles.map((file) => {
        const Icon = file.mimeType?.startsWith('image/')
          ? ImageIcon
          : file.mimeType?.startsWith('video/')
            ? Film
            : file.kind === 'note' || file.mimeType?.startsWith('text/')
              ? FileText
              : File
        return (
          <Button
            key={file._id}
            variant="ghost"
            type="button"
            onClick={() => onOpenFile ? onOpenFile(file) : router.push(buildWorkspaceHref(
              null, `/app/files?file=${encodeURIComponent(file._id)}`, file.scope ?? 'personal',
            ))}
            className="group/file h-auto min-h-12 w-full justify-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-(--surface-subtle)"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--muted) group-hover/file:bg-(--surface-elevated)">
              {file.mimeType?.startsWith('image/') ? (
                <NextImage
                  src={`/api/v1/files/${encodeURIComponent(file._id)}/content`}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                  className="size-8 rounded-lg object-cover"
                />
              ) : <Icon size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-(--foreground)">{file.name}</span>
              <span className="mt-0.5 block text-xs text-(--muted)">
                {[formatFileSize(file.sizeBytes), formatRelativeTime(file.createdAt)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </Button>
        )
      })}
    </div>
  )
}

function formatFileSize(size: number | undefined) {
  if (!size) return null
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return 'just now'
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
