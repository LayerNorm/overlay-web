'use client'
import type { FileTreeEntry } from '@overlay/app-core'
import { childFilesForTree, rootFilesForTree } from '@overlay/app-core'
import { SidebarMenuAction, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { BookOpen, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { FileTypeIcon } from './shared/file-type-icon'

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
        className={`group/menu-sub-item relative rounded-md ${dragOver ? 'bg-(--surface-subtle) ring-1 ring-inset ring-(--foreground)' : ''}`}
      >
        <SidebarMenuSubButton
          isActive={activeFileId === file._id}
          aria-current={activeFileId === file._id ? 'page' : undefined}
          onClick={() => onOpen(file)}
          className={file.type === 'folder' ? 'pr-8' : undefined}
        >
          {file.type === 'folder'
            ? open
              ? <FolderOpen aria-hidden />
              : <Folder aria-hidden />
            : file.kind === 'note'
              ? <BookOpen aria-hidden />
              : <FileTypeIcon file={file} size={16} />}
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
        </SidebarMenuSubButton>
        {file.type === 'folder' ? (
          <SidebarMenuAction
            onClick={(event) => {
              event.stopPropagation()
              onToggle(file._id)
            }}
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
            aria-expanded={open}
          >
            <ChevronRight className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </SidebarMenuAction>
        ) : null}
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
