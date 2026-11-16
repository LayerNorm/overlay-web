'use client'

import { useEffect, useState } from 'react'
import { File as FileIcon, FileCode, FileText } from 'lucide-react'
import type { KnowledgeFile } from '@overlay/app-core'
import { Button } from '@overlay/ui/primitives'
import { chatFileKind, fileContentUrl } from '@overlay/chat-react'
import { useConversationFiles } from '@/hooks/use-file-tree'

const LIBRARY_SEEN_KEY = 'overlay:agent-library-seen:'

/** When the viewer last looked at this thread's Library, so files made since then carry a dot. Storage may be blocked. */
function useLibrarySeenAt(conversationId: string): number | null {
  const [seenAt] = useState<number | null>(() => {
    try {
      const value = Number(window.localStorage.getItem(LIBRARY_SEEN_KEY + conversationId))
      return Number.isFinite(value) && value > 0 ? value : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    const remember = () => {
      try { window.localStorage.setItem(LIBRARY_SEEN_KEY + conversationId, String(Date.now())) } catch { /* blocked storage */ }
    }
    remember()
    return remember
  }, [conversationId])
  return seenAt
}

function LibraryThumb({ file }: { file: KnowledgeFile }) {
  const kind = chatFileKind(file)
  const url = fileContentUrl(file._id)
  if (kind === 'image') {
    return (
      <span className="size-8 shrink-0 overflow-hidden rounded-lg bg-(--surface-subtle)">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated file route, not an optimizable asset */}
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      </span>
    )
  }
  if (kind === 'video') {
    return (
      <span className="size-8 shrink-0 overflow-hidden rounded-lg bg-black">
        <video src={`${url}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1}
          className="pointer-events-none size-full object-cover" />
      </span>
    )
  }
  const Icon = kind === 'note' ? FileText : file.kind === 'output' ? FileCode : FileIcon
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--muted) group-hover/file:bg-(--surface-elevated)">
      <Icon size={15} />
    </span>
  )
}

const KIND_LABEL = { image: 'Image', video: 'Video', note: 'Note', file: 'File' } as const

/** The thread's files, newest first, live: notes, images, videos and documents the agent or people added. */
export function AgentLibraryTab({ conversationId, onOpenFile }: { conversationId: string; onOpenFile(fileId: string): void }) {
  const files = useConversationFiles(conversationId)
  const seenAt = useLibrarySeenAt(conversationId)
  if (files === null) return <p className="py-2 text-xs text-(--muted)">Could not load files.</p>
  if (!files) return <p className="py-2 text-xs text-(--muted)">Loading files...</p>
  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <p className="text-xs text-(--muted)">No files yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {files.map((file) => {
        const fresh = seenAt !== null && file.createdAt > seenAt
        return (
          <Button
            key={file._id}
            variant="ghost"
            type="button"
            onClick={() => onOpenFile(file._id)}
            className="group/file h-auto min-h-12 w-full justify-start gap-2.5 rounded-lg px-2 py-2 text-left font-normal hover:bg-(--surface-subtle)"
          >
            <LibraryThumb file={file} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-(--foreground)">{file.name}</span>
              <span className="mt-0.5 block text-xs text-(--muted)">
                {KIND_LABEL[chatFileKind(file)]} · Created {formatRelativeTime(file.createdAt)}
              </span>
            </span>
            {fresh ? <span className="size-1.5 shrink-0 rounded-full bg-(--foreground)/60" aria-label="New since you last looked" /> : null}
          </Button>
        )
      })}
    </div>
  )
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
