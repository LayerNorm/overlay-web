'use client'

import type { FileTreeEntry } from '@overlay/app-core'
import { childFilesForTree, rootFilesForTree } from '@overlay/app-core'
import { SidebarMenuSub, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { BookOpen, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { FileTypeIcon } from './shared/file-type-icon'

const panelItemClass =
  'group flex h-7 items-center gap-2 rounded-md px-2.5 py-0 text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)'

export interface FilesInlineBranchProps {
  file: FileTreeEntry
  allFiles: readonly FileTreeEntry[]
  expanded: ReadonlySet<string>
  activeFileId: string | null
  onToggle: (fileId: string) => void
  onOpen: (file: FileTreeEntry) => void
  onMove: (fileId: string, parentId: string | null) => void
}

export function FilesInlineBranch({
  file,
  allFiles,
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
        className={`${panelItemClass} ${dragOver ? 'bg-(--surface-subtle) ring-1 ring-inset ring-(--foreground)' : activeFileId === file._id ? 'bg-(--surface-subtle) text-(--foreground)' : ''}`}
      >
        {file.type === 'folder' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(file._id)
            }}
            className="shrink-0 rounded-sm p-0.5 text-(--muted) hover:bg-(--border) hover:text-(--foreground)"
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
          >
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(file)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xs text-left outline-hidden focus-visible:ring-1 focus-visible:ring-(--foreground)"
        >
          {file.type === 'folder'
            ? open
              ? <FolderOpen size={12} className="shrink-0" />
              : <Folder size={12} className="shrink-0" />
            : file.kind === 'note'
              ? <BookOpen size={12} className="shrink-0 text-(--muted-light)" />
              : <FileTypeIcon file={file} size={12} className="text-(--muted-light)" />}
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
        </button>
      </div>

      {file.type === 'folder' && open && children.length > 0 ? (
        // An open folder nests its children under the same guide line as an agent's threads (`SidebarMenuSub`).
        <SidebarMenuSub>
          {children.map((child) => (
            <SidebarMenuSubItem key={child._id}>
              <FilesInlineBranch
                file={child}
                allFiles={allFiles}
                expanded={expanded}
                activeFileId={activeFileId}
                onToggle={onToggle}
                onOpen={onOpen}
                onMove={onMove}
              />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      ) : null}
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
  if (loading) return <>{loadingContent ?? <p className="px-2.5 py-2 text-xs text-(--muted-light)">Loading...</p>}</>
  if (roots.length === 0) return <p className="px-2.5 py-2 text-xs text-(--muted-light)">{emptyLabel}</p>
  return (
    <>
      {roots.map((file) => (
        <FilesInlineBranch
          key={file._id}
          file={file}
          allFiles={files}
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
