'use client'

import type { FileTreeEntry } from '@overlay/app-core'
import { childFilesForTree, rootFilesForTree } from '@overlay/app-core'
import { BookOpen, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { FileTypeIcon } from './shared/file-type-icon'

const panelItemClass =
  'group flex h-7 items-center gap-2 rounded-md px-2.5 py-0 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export interface FilesInlineBranchProps {
  file: FileTreeEntry
  allFiles: readonly FileTreeEntry[]
  depth: number
  expanded: ReadonlySet<string>
  activeFileId: string | null
  onToggle: (fileId: string) => void
  onOpen: (file: FileTreeEntry) => void
  onMove: (fileId: string, parentId: string | null) => void
}

export function FilesInlineBranch({
  file,
  allFiles,
  depth,
  expanded,
  activeFileId,
  onToggle,
  onOpen,
  onMove,
}: FilesInlineBranchProps) {
  const children = childFilesForTree(allFiles, file._id)
  const open = expanded.has(file._id)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-overlay-file-id', file._id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          if (file.type !== 'folder') return
          if (!event.dataTransfer.types.includes('application/x-overlay-file-id')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (!dragOver) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (file.type !== 'folder') return
          event.preventDefault()
          setDragOver(false)
          const fileId = event.dataTransfer.getData('application/x-overlay-file-id')
          if (!fileId || fileId === file._id) return
          onMove(fileId, file._id)
        }}
        onClick={() => onOpen(file)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(file)
          }
        }}
        className={`${panelItemClass} cursor-pointer ${dragOver ? 'bg-[var(--surface-subtle)] ring-1 ring-inset ring-[var(--foreground)]' : activeFileId === file._id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        {file.type === 'folder' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(file._id)
            }}
            className="shrink-0 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]"
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
          >
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : null}
        {file.type === 'folder'
          ? open
            ? <FolderOpen size={12} className="shrink-0" />
            : <Folder size={12} className="shrink-0" />
          : file.kind === 'note'
            ? <BookOpen size={12} className="shrink-0 text-[var(--muted-light)]" />
            : <FileTypeIcon file={file} size={12} className="text-[var(--muted-light)]" />}
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
      </div>

      {file.type === 'folder' && open && children.map((child) => (
        <FilesInlineBranch
          key={child._id}
          file={child}
          allFiles={allFiles}
          depth={depth + 1}
          expanded={expanded}
          activeFileId={activeFileId}
          onToggle={onToggle}
          onOpen={onOpen}
          onMove={onMove}
        />
      ))}
    </div>
  )
}

export interface FilesInlineTreeProps {
  files: readonly FileTreeEntry[]
  loading?: boolean
  loadingContent?: ReactNode
  emptyLabel?: ReactNode
  activeFileId: string | null
  expanded: ReadonlySet<string>
  onToggle: (fileId: string) => void
  onOpen: (file: FileTreeEntry) => void
  onMove: (fileId: string, parentId: string | null) => void
}

export function FilesInlineTree({
  files,
  loading,
  loadingContent,
  emptyLabel = 'No files yet',
  activeFileId,
  expanded,
  onToggle,
  onOpen,
  onMove,
}: FilesInlineTreeProps) {
  const roots = rootFilesForTree(files)
  if (loading) return <>{loadingContent ?? <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">Loading...</p>}</>
  if (roots.length === 0) return <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">{emptyLabel}</p>
  return (
    <>
      {roots.map((file) => (
        <FilesInlineBranch
          key={file._id}
          file={file}
          allFiles={files}
          depth={0}
          expanded={expanded}
          activeFileId={activeFileId}
          onToggle={onToggle}
          onOpen={onOpen}
          onMove={onMove}
        />
      ))}
    </>
  )
}
