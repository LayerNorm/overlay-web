'use client'

import { BookOpen, Copy, FilePlus, FileX, Github, TriangleAlert } from 'lucide-react'
import type { FolderSavesData } from '@/shared/agents/folder-saves'

/**
 * Under an agent's reply: what the run saved back to Files and the pull requests it opened
 * (internal/develop/thread-folders.md). Kept compact: one row per change, at most a handful shown per folder.
 */

const SHOWN_PER_FOLDER = 6

const ACTION_LABEL = { created: 'New', updated: 'Updated', deleted: 'Deleted', saved_as_copy: 'Saved as a copy' } as const

function ActionIcon({ action }: { action: keyof typeof ACTION_LABEL }) {
  const className = 'shrink-0 text-(--muted)'
  if (action === 'created') return <FilePlus size={14} strokeWidth={1.75} className={className} aria-hidden />
  if (action === 'deleted') return <FileX size={14} strokeWidth={1.75} className={className} aria-hidden />
  if (action === 'saved_as_copy') return <Copy size={14} strokeWidth={1.75} className={className} aria-hidden />
  return <BookOpen size={14} strokeWidth={1.75} className={className} aria-hidden />
}

export function FolderSavesCard({ data }: { data: FolderSavesData }) {
  const rows = data.folders.flatMap(folder => [
    ...folder.saved.slice(0, SHOWN_PER_FOLDER).map(item => ({ key: `${folder.folderId}:${item.path}`, folder: folder.folderName, ...item })),
  ])
  const hidden = data.folders.reduce((total, folder) => total + Math.max(0, folder.saved.length - SHOWN_PER_FOLDER), 0)
  const failed = data.folders.flatMap(folder => folder.failed.map(item => ({ folder: folder.folderName, ...item })))
  const skipped = data.folders.reduce((total, folder) => total + folder.skipped.length, 0)
  if (rows.length === 0 && failed.length === 0 && data.pullRequests.length === 0) return null
  return (
    <div className="mt-3 divide-y divide-(--border) rounded-xl border border-(--border)" aria-label="Saved back">
      {data.pullRequests.map(pull => (
        <div key={pull.url} className="flex items-center gap-3 px-3 py-2.5">
          <Github size={14} strokeWidth={1.75} className="shrink-0 text-(--foreground)" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-(--foreground)">{pull.title}</p>
            <p className="truncate text-[11px] text-(--muted-light)">{pull.repository} · pull request #{pull.number}{pull.branch ? ` · ${pull.branch}` : ''}</p>
          </div>
          <a href={pull.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-(--muted) hover:text-(--foreground)">Review</a>
        </div>
      ))}
      {rows.map(row => (
        <div key={row.key} className="flex items-center gap-3 px-3 py-2">
          <ActionIcon action={row.action} />
          <div className="min-w-0 flex-1">
            {/* Markdown files are notes in Files, named without the extension. */}
            <p className="truncate text-[13px] text-(--foreground)">{row.path.slice(row.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')}</p>
            <p className="truncate text-[11px] text-(--muted-light)">
              {ACTION_LABEL[row.action]} in {row.folder}{row.action === 'saved_as_copy' ? ' because it changed in Files while the agent worked' : ''}
            </p>
          </div>
        </div>
      ))}
      {failed.map(item => (
        <div key={`${item.folder}:${item.path}:${item.reason}`} className="flex items-center gap-3 px-3 py-2">
          <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 text-(--muted)" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-[11px] text-(--muted)">
            {item.path ? `${item.path} wasn’t saved: ` : `${item.folder} wasn’t saved: `}{item.reason}
          </p>
        </div>
      ))}
      {hidden > 0 || skipped > 0 ? (
        <p className="px-3 py-2 text-[11px] text-(--muted-light)">
          {[hidden > 0 ? `${hidden} more saved` : '', skipped > 0 ? `${skipped} left out (too large, too many, or changed in Files)` : ''].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
