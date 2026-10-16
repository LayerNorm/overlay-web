'use client'

import { ChevronRight, FileText, Folder } from 'lucide-react'
import type { DriveSyncStatus } from '@layernorm/overlay-agent-bridge-protocol'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'

export function RemoteDriveStatus({ status }: { status: DriveSyncStatus }) {
  const workspace = useOptionalWorkspace()
  const base = workspace?.activeWorkspaceId ? buildWorkspaceHref(workspace.activeWorkspaceId, '/app/files') : '/app/files'
  if (status.state === 'saving') return <p role="status" className="py-1 text-xs text-(--muted)">Saving files…</p>
  if (status.state === 'unsaved') return <p role="status" className="py-1 text-xs text-(--muted)">Files weren’t saved. Your local copies are still on the agent machine.</p>
  if (status.fileCount + status.folderCount === 0) return null
  const counts = [status.fileCount ? `${status.fileCount} ${status.fileCount === 1 ? 'file' : 'files'}` : '',
    status.folderCount ? `${status.folderCount} ${status.folderCount === 1 ? 'folder' : 'folders'}` : ''].filter(Boolean).join(' and ')
  return (
    <details className="group/drive py-1 text-xs text-(--muted)">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 hover:text-(--foreground) [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} aria-hidden className="transition-transform group-open/drive:rotate-90" />
        Saved {counts} to your drive
      </summary>
      <ul className="mt-2 space-y-1 pl-4">
        {status.entries.map(entry => (
          <li key={entry.fileId}>
            <a href={`${base}?${entry.kind === 'folder' ? 'folder' : 'file'}=${encodeURIComponent(entry.fileId)}`}
              className="inline-flex max-w-full items-center gap-1.5 hover:text-(--foreground) hover:underline">
              {entry.kind === 'folder' ? <Folder size={12} aria-hidden /> : <FileText size={12} aria-hidden />}
              <span className="truncate">{entry.path}</span>
            </a>
          </li>
        ))}
        {status.entries.length < status.fileCount + status.folderCount ? <li><a className="hover:underline" href={base}>View all files</a></li> : null}
      </ul>
    </details>
  )
}
