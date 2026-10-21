'use client'

import { useEffect, useState } from 'react'
import { FileCode, FileText, Image } from 'lucide-react'
import type { KnowledgeFile } from '@overlay/app-core'
import { Button } from '@overlay/ui/primitives'
import { useRouter } from 'next/navigation'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function AgentLibraryTab({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const [files, setFiles] = useState<KnowledgeFile[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setFailed(false)
    void overlayAppClient.files.get<KnowledgeFile[]>(
      { conversationId, limit: 100, summary: true },
      { cache: 'no-store' },
    ).then((result) => {
      if (!cancelled) setFiles(result)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [conversationId])

  if (failed) return <p className="py-2 text-xs text-(--muted)">Could not load files.</p>
  if (!files) return <p className="py-2 text-xs text-(--muted)">Loading files...</p>
  if (files.length === 0) return <p className="py-2 text-xs text-(--muted)">No files yet</p>

  return (
    <div className="flex flex-col">
      {files.map((file) => {
        const Icon = file.mimeType?.startsWith('image/')
          ? Image
          : file.kind === 'output'
            ? FileCode
            : FileText
        const fileTarget = file.kind === 'folder' ? 'folder' : 'file'
        return (
          <Button
            key={file._id}
            variant="ghost"
            type="button"
            onClick={() => router.push(`/app/files?${fileTarget}=${encodeURIComponent(file._id)}`)}
            className="h-auto min-h-12 justify-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-(--surface-subtle)"
          >
            <Icon size={16} className="shrink-0 text-(--muted)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-(--foreground)">{file.name}</span>
              <span className="mt-0.5 block text-[11px] text-(--muted)">
                Created {formatRelativeTime(file.createdAt)}
              </span>
            </span>
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
