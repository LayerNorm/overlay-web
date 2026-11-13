'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Download, ExternalLink, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@overlay/ui/primitives'
import { chatFileKind, fileContentUrl, useChatFilesHost } from '@overlay/chat-react'
import { shouldFetchTextContent } from '@overlay/app-core/file-viewer'
import { FileViewer, type FileViewerAsset } from '@overlay/modules-react/knowledge'
import { useLiveNote } from '@/hooks/use-file-tree'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'

function downloadFile({ name, url }: FileViewerAsset): void {
  if (!url) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}

const viewerOperations = {
  download: downloadFile,
  openExternal: ({ url }: FileViewerAsset) => {
    const safe = safeHttpUrl(url)
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
  },
}

/** Text for text-like files that are not notes, read once from the content route. */
function useFileText(fileId: string, name: string, enabled: boolean): string {
  const [text, setText] = useState<{ fileId: string; value: string } | null>(null)
  useEffect(() => {
    if (!enabled || !shouldFetchTextContent(name)) return
    let cancelled = false
    void overlayAppClient.files.contentResponse(fileId)
      .then(async (response) => (response.ok ? await response.text() : ''))
      .then((value) => { if (!cancelled) setText({ fileId, value }) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [enabled, fileId, name])
  return text?.fileId === fileId ? text.value : ''
}

/**
 * One Library file previewed inside the agent's right panel, so the user never leaves the thread: back to the list,
 * open in Files, download, close. Notes render their live Markdown; media and documents use the shared viewer.
 */
export function AgentLibraryPreview({ fileId, onBack, onClose }: { fileId: string; onBack(): void; onClose(): void }) {
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const { useFileSummaries } = useChatFilesHost()
  const summaries = useFileSummaries([fileId])
  const file = summaries?.get(fileId)
  const kind = file ? chatFileKind(file) : null
  const note = useLiveNote(kind === 'note' ? fileId : null)
  const name = file?.name ?? ''
  const viewerName = kind === 'note' ? `${name || 'Note'}.md` : name
  const fetchedText = useFileText(fileId, viewerName, Boolean(file) && kind !== 'note')
  const url = fileContentUrl(fileId)
  const content = kind === 'note' ? note?.content ?? '' : fetchedText
  const meta = kind === 'note' ? 'Note' : kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'File'

  return (
    <aside data-slot="right-sidebar" aria-label="File preview"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-(--sidebar-surface)">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-(--border) px-2 py-2.5">
        <Button variant="ghost" size="icon-sm" type="button" aria-label="Back to Library" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-(--foreground)">{name || 'Loading…'}</span>
          <span className="truncate text-[11px] text-(--muted)">{file ? meta : ''}</span>
        </span>
        <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      {summaries && !file ? (
        <p className="p-4 text-xs text-(--muted)">This file is no longer available.</p>
      ) : file ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&_.overlay-file-viewer]:px-4 [&_.overlay-file-viewer]:py-4">
            <FileViewer key={fileId} name={viewerName} content={content} url={kind === 'note' ? undefined : url}
              operations={viewerOperations} />
          </div>
          <div className="flex shrink-0 gap-1.5 border-t border-(--border) px-3 py-2.5">
            <Button variant="secondary" size="sm" type="button"
              onClick={() => router.push(buildWorkspaceHref(null, `/app/files?file=${encodeURIComponent(fileId)}`))}>
              <ExternalLink size={14} />Open in Files
            </Button>
            {kind !== 'note' ? (
              <Button variant="ghost" size="sm" type="button" onClick={() => downloadFile({ name, url })}>
                <Download size={14} />Download
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  )
}
