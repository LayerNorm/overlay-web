'use client'

import type {
ProjectFileSummary
} from '@overlay/app-core'
import { childProjectFiles,rootProjectFiles } from '@overlay/app-core'
import { BookOpen,ChevronRight,Folder,FolderOpen,Trash2 } from 'lucide-react'
import { useState,type MouseEvent,type ReactNode } from 'react'

import { FileTypeIcon } from '../shared/file-type-icon'
import { PROJECT_TREE_CHEVRON_COL,PROJECT_TREE_DEPTH_STEP_PX,PROJECT_TREE_ICON_COL,panelItemClass } from './shared'

export interface ProjectFileTreeNodeProps {
  file: ProjectFileSummary
  allFiles: readonly ProjectFileSummary[]
  depth: number
  baseIndentPx: number
  legacyInline?: boolean
  expandedIds: ReadonlySet<string>
  onToggleFolder: (id: string, event: MouseEvent) => void
  onOpenFile: (id: string) => void
  onDeleteFile: (id: string, event: MouseEvent) => void
}

export function ProjectFileTreeNode({
  file,
  allFiles,
  depth,
  baseIndentPx,
  legacyInline = false,
  expandedIds,
  onToggleFolder,
  onOpenFile,
  onDeleteFile,
}: ProjectFileTreeNodeProps) {
  const children = childProjectFiles(allFiles, file._id)
  const isFolder = file.type === 'folder'
  const open = expandedIds.has(file._id)
  const rowPadLeft = legacyInline
    ? baseIndentPx + depth * 12
    : baseIndentPx + depth * PROJECT_TREE_DEPTH_STEP_PX

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (isFolder) onToggleFolder(file._id, event as unknown as MouseEvent)
            else onOpenFile(file._id)
          }
        }}
        className={`group flex items-center gap-1.5 py-1.5 rounded-md text-xs text-[#525252] transition-colors ${
          file.type === 'file' ? 'cursor-pointer hover:bg-[#ebebeb] hover:text-[#0a0a0a]' : 'cursor-pointer hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
        }`}
        style={{ paddingLeft: `${rowPadLeft}px`, paddingRight: '8px' }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          if (isFolder) onToggleFolder(file._id, event)
          else onOpenFile(file._id)
        }}
      >
        {legacyInline ? (
          isFolder ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFolder(file._id, event)
                }}
                className="shrink-0 p-0.5 rounded hover:bg-[#d8d8d8] transition-colors"
              >
                <ChevronRight size={10} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              {open
                ? <FolderOpen size={12} className="shrink-0 text-[#888]" />
                : <Folder size={12} className="shrink-0 text-[#888]" />}
            </>
          ) : (
            <>
              <span className="w-[18px] shrink-0 inline-block" />
              <FileTypeIcon file={file} size={12} className="text-[#888]" />
            </>
          )
        ) : isFolder ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggleFolder(file._id, event)
              }}
              className={`${PROJECT_TREE_CHEVRON_COL} p-0.5 rounded hover:bg-[#d8d8d8] transition-colors`}
            >
              <ChevronRight size={10} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            <div className={PROJECT_TREE_ICON_COL}>
              {open ? <FolderOpen size={12} /> : <Folder size={12} />}
            </div>
          </>
        ) : (
          <>
            <div className={PROJECT_TREE_CHEVRON_COL} aria-hidden />
            <div className={PROJECT_TREE_ICON_COL}>
              <FileTypeIcon file={file} size={12} />
            </div>
          </>
        )}
        <span className="flex-1 truncate">{file.name}</span>
        <button
          type="button"
          onClick={(event) => onDeleteFile(file._id, event)}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity shrink-0"
        >
          <Trash2 size={10} />
        </button>
      </div>
      {isFolder && open && children.map((child) => (
        <ProjectFileTreeNode
          key={child._id}
          file={child}
          allFiles={allFiles}
          depth={depth + 1}
          baseIndentPx={baseIndentPx}
          legacyInline={legacyInline}
          expandedIds={expandedIds}
          onToggleFolder={onToggleFolder}
          onOpenFile={onOpenFile}
          onDeleteFile={onDeleteFile}
        />
      ))}
    </div>
  )
}

export interface FilesInlineBranchProps {
  file: ProjectFileSummary
  allFiles: readonly ProjectFileSummary[]
  depth: number
  expanded: ReadonlySet<string>
  activeFileId: string | null
  onToggle: (fileId: string) => void
  onOpen: (file: ProjectFileSummary) => void
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
  const children = childProjectFiles(allFiles, file._id)
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
  files: readonly ProjectFileSummary[]
  loading?: boolean
  loadingContent?: ReactNode
  emptyLabel?: ReactNode
  activeFileId: string | null
  expanded: ReadonlySet<string>
  onToggle: (fileId: string) => void
  onOpen: (file: ProjectFileSummary) => void
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
  const roots = rootProjectFiles(files)
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
