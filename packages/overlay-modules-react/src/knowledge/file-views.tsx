'use client'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '../control-reset'
import type { KnowledgeFileNode } from '@overlay/app-core'
import { filePathLabel } from '@overlay/app-core'
import { BookOpen, Folder, Trash2 } from 'lucide-react'
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from 'react'

import { FileTypeIcon } from '../shared/file-type-icon'
import { BulkSelectMarker } from './selection'

/**
 * Extra hover controls for a row (the web app puts Move to Workspace/Personal and Archive here, since they depend on who
 * is viewing). Absent means none.
 */
export const KnowledgeRowActionsContext = createContext<((node: KnowledgeFileNode) => ReactNode) | null>(null)

export function KnowledgeFileList({
  nodes,
  selectedId,
  selectedIds,
  selectMode,
  onSelect,
  onFolderOpen,
  onDelete,
  onToggleBulk,
  onMove,
}: {
  nodes: readonly KnowledgeFileNode[]
  selectedId: string | null
  selectedIds?: ReadonlySet<string>
  selectMode?: boolean
  onSelect: (node: KnowledgeFileNode) => void
  onFolderOpen: (folderId: string) => void
  onDelete: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  onToggleBulk?: (id: string) => void
  onMove?: (fileId: string, parentId: string | null) => void
}) {
  return (
    <div className="overlay-knowledge-list mx-auto max-w-3xl space-y-0.5">
      {nodes.map((node) => (
        <FileTreeRow
          key={node._id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          onFolderOpen={onFolderOpen}
          onDelete={onDelete}
          bulkSelectMode={selectMode}
          bulkSelectedIds={selectedIds}
          onToggleBulk={onToggleBulk}
          onMove={onMove}
        />
      ))}
    </div>
  )
}

export function FileTreeRow({
  node,
  selectedId,
  onSelect,
  onFolderOpen,
  onDelete,
  bulkSelectMode = false,
  bulkSelectedIds,
  onToggleBulk,
  onMove,
}: {
  node: KnowledgeFileNode
  selectedId: string | null
  onSelect: (node: KnowledgeFileNode) => void
  onFolderOpen: (folderId: string) => void
  onDelete: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  bulkSelectMode?: boolean
  bulkSelectedIds?: ReadonlySet<string>
  onToggleBulk?: (id: string) => void
  onMove?: (fileId: string, parentId: string | null) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const renderRowActions = useContext(KnowledgeRowActionsContext)
  const isFileViewerSelected = node.type === 'file' && node._id === selectedId
  const isBulkSelected = Boolean(bulkSelectedIds?.has(node._id))

  function handleRowClick() {
    if (bulkSelectMode && onToggleBulk) {
      onToggleBulk(node._id)
      return
    }
    if (node.type === 'folder') onFolderOpen(node._id)
    else onSelect(node)
  }

  return (
    <div>
      <div
        draggable={!bulkSelectMode}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-overlay-file-id', node._id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          if (node.type !== 'folder' || !onMove) return
          const draggingId = event.dataTransfer.types.includes('application/x-overlay-file-id')
          if (!draggingId) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (!dragOver) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (node.type !== 'folder' || !onMove) return
          event.preventDefault()
          setDragOver(false)
          const fileId = event.dataTransfer.getData('application/x-overlay-file-id')
          if (!fileId || fileId === node._id) return
          onMove(fileId, node._id)
        }}
        className={`overlay-knowledge-row group flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-(--border) hover:bg-(--surface-muted) ${
          dragOver
            ? 'border-(--foreground) bg-(--surface-muted)'
            : isFileViewerSelected && !bulkSelectMode
              ? 'border-(--border) bg-(--surface-muted) text-(--foreground)'
              : isBulkSelected
                ? 'border-(--border) bg-(--surface-muted)'
                : 'border-transparent text-(--foreground)'
        }`}
        style={{ paddingLeft: '12px' }}
      >
        {bulkSelectMode ? <BulkSelectMarker selected={isBulkSelected} className="mt-0.5 shrink-0" /> : null}
        <Button variant="ghost"
          type="button"
          onClick={handleRowClick}
          className={unstyledButton("flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xs text-left outline-hidden focus-visible:ring-1 focus-visible:ring-(--foreground)")}
        >
          {node.type === 'folder' ? (
            <Folder size={14} className="shrink-0 text-(--muted-light)" />
          ) : node.kind === 'note' ? (
            <BookOpen size={14} className="shrink-0 text-(--muted-light)" />
          ) : (
            <FileTypeIcon file={node} size={15} className="text-(--muted-light)" />
          )}
          <span className="min-w-0 flex-1 truncate leading-relaxed">{node.name}</span>
        </Button>
        {!bulkSelectMode ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {renderRowActions?.(node)}
          </span>
        ) : null}
        {!bulkSelectMode ? (
          <Button variant="ghost"
            type="button"
            aria-label={`Delete ${node.name}`}
            onClick={(event) => onDelete(node._id, event)}
            className={unstyledButton("shrink-0 rounded-sm p-1 text-(--muted-light) opacity-0 transition-opacity hover:bg-(--surface-subtle) hover:text-red-500 group-hover:opacity-100")}
          >
            <Trash2 size={12} />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function KnowledgeFileCards({
  folders,
  files,
  allFiles,
  selectedIds,
  selectMode,
  onOpenFolder,
  onOpenFile,
  onToggleBulk,
  onMove,
}: {
  folders: readonly KnowledgeFileNode[]
  files: readonly KnowledgeFileNode[]
  allFiles: readonly KnowledgeFileNode[]
  selectedIds: ReadonlySet<string>
  selectMode: boolean
  onOpenFolder: (folderId: string) => void
  onOpenFile: (file: KnowledgeFileNode) => void
  onToggleBulk: (fileId: string) => void
  onMove?: (fileId: string, parentId: string | null) => void
}) {
  return (
    <div className="overlay-knowledge-card-grid mx-auto w-full max-w-[1440px] columns-1 gap-4 gap-x-4 sm:columns-2 lg:columns-3 xl:columns-4">
      {folders.map((folder) => (
        <CardActionsOverlay key={folder._id} node={folder} selectMode={selectMode}>
          <FolderCard
            folder={folder}
            bulkSel={selectedIds.has(folder._id)}
            selectMode={selectMode}
            onOpen={() =>
              selectMode ? onToggleBulk(folder._id) : onOpenFolder(folder._id)
            }
            onMove={onMove}
          />
        </CardActionsOverlay>
      ))}
      {files.map((file) => (
        <CardActionsOverlay key={file._id} node={file} selectMode={selectMode}>
          <FileCard
            file={file}
            allFiles={allFiles}
            bulkSel={selectedIds.has(file._id)}
            selectMode={selectMode}
            onOpen={() =>
              selectMode ? onToggleBulk(file._id) : onOpenFile(file)
            }
          />
        </CardActionsOverlay>
      ))}
    </div>
  )
}

/**
 * A card is one big button, so its hover controls sit beside it rather than inside it (a button cannot hold buttons).
 * Shows whatever the host supplies through `KnowledgeRowActionsContext`.
 */
function CardActionsOverlay({
  node,
  selectMode,
  children,
}: {
  node: KnowledgeFileNode
  selectMode: boolean
  children: ReactNode
}) {
  const renderRowActions = useContext(KnowledgeRowActionsContext)
  const actions = !selectMode ? renderRowActions?.(node) : null
  return (
    <div className="group/card relative" style={{ breakInside: 'avoid' }}>
      {children}
      {actions ? (
        <span className="absolute right-2 top-2 z-10 flex items-center rounded-md border border-(--border) bg-(--surface-elevated) opacity-0 shadow-xs transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
          {actions}
        </span>
      ) : null}
    </div>
  )
}

export function FileCard({
  file,
  allFiles,
  bulkSel,
  selectMode,
  onOpen,
}: {
  file: KnowledgeFileNode
  allFiles: readonly KnowledgeFileNode[]
  bulkSel: boolean
  selectMode: boolean
  onOpen: () => void
}) {
  const notePreview = file.kind === 'note'
    ? (file.previewText ?? file.textContent ?? file.content ?? '').trim()
    : ''

  return (
    <Button variant="ghost"
      type="button"
      draggable={!selectMode}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-overlay-file-id', file._id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className={unstyledButton(`overlay-knowledge-card overlay-knowledge-card--file group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border bg-(--surface-elevated) text-left transition-shadow hover:shadow-md ${
        bulkSel ? 'border-(--foreground) ring-1 ring-(--foreground)/20' : 'border-(--border)'
      }`)}
      style={{ breakInside: 'avoid' }}
    >
      {selectMode ? (
        <BulkSelectMarker
          selected={bulkSel}
          className='absolute left-3 top-3 z-10'
        />
      ) : null}
      {file.kind === 'note' ? (
        <div className="h-36 overflow-hidden bg-(--surface-muted) p-3">
          <div className="h-full overflow-hidden rounded-lg border border-(--border) bg-(--surface-elevated) px-3 py-2.5 shadow-xs">
            <p
              className={`whitespace-pre-wrap text-[10px] leading-[1.45] ${
                notePreview
                  ? 'text-(--muted)'
                  : 'italic text-(--muted-light)'
              }`}
            >
              {notePreview || 'Empty note'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex h-28 items-center justify-center bg-(--surface-muted)">
          <FileTypeIcon file={file} size={36} framed />
        </div>
      )}
      <div className="px-3 py-2">
        <p className='line-clamp-2 text-xs font-medium text-(--foreground)'>
          {file.name}
        </p>
        <p className='mt-1 line-clamp-2 text-[10px] text-(--muted)'>
          {filePathLabel(allFiles, file)}
        </p>
        <p className="mt-1 text-[10px] text-(--muted-light)">
          {
            // Locale pinned to 'en-US'.
            // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
            new Date(file.updatedAt).toLocaleDateString('en-US')
          }
        </p>
      </div>
    </Button>
  )
}

export function FolderCard({
  folder,
  bulkSel,
  selectMode,
  onOpen,
  onMove,
}: {
  folder: KnowledgeFileNode
  bulkSel: boolean
  selectMode: boolean
  onOpen: () => void
  onMove?: (fileId: string, parentId: string | null) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <Button variant="ghost"
      type="button"
      draggable={!selectMode}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-overlay-file-id', folder._id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (!onMove) return
        if (!event.dataTransfer.types.includes('application/x-overlay-file-id')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!onMove) return
        event.preventDefault()
        setDragOver(false)
        const fileId = event.dataTransfer.getData('application/x-overlay-file-id')
        if (!fileId || fileId === folder._id) return
        onMove(fileId, folder._id)
      }}
      onClick={onOpen}
      className={unstyledButton(`overlay-knowledge-card overlay-knowledge-card--folder group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border bg-(--surface-elevated) text-left transition-shadow hover:shadow-md ${
        dragOver
          ? 'border-(--foreground) ring-1 ring-(--foreground)/20'
          : bulkSel ? 'border-(--foreground) ring-1 ring-(--foreground)/20' : 'border-(--border)'
      }`)}
      style={{ breakInside: 'avoid' }}
    >
      <div className="flex h-28 items-center justify-center bg-(--surface-muted)">
        <Folder size={36} className="text-(--muted-light)" />
      </div>
      <div className="px-3 py-2">
        <p className='line-clamp-2 text-xs font-medium text-(--foreground)'>
          {folder.name}
        </p>
        <p className="mt-1 text-[10px] text-(--muted-light)">Folder</p>
      </div>
    </Button>
  )
}

export function KnowledgeFileCardsSkeleton({ cards = 10 }: { cards?: number }) {
  return (
    <div
      className='overlay-knowledge-card-grid mx-auto w-full max-w-[1440px] columns-1 gap-4 gap-x-4 sm:columns-2 lg:columns-3 xl:columns-4'
      aria-hidden
    >
      {Array.from({ length: cards }).map((_, index) => (
        <div
          key={index}
          className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)"
          style={{ breakInside: 'avoid' }}
        >
          <div className="flex h-28 items-center justify-center bg-(--surface-muted)">
            <div className="ui-skeleton-line h-9 w-9 rounded-md" />
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <div className={`ui-skeleton-line h-3 rounded-sm ${index % 3 === 0 ? 'w-4/5' : index % 3 === 1 ? 'w-3/5' : 'w-2/3'}`} />
            <div className="ui-skeleton-line h-2.5 w-2/5 rounded-sm opacity-75" />
            <div className="ui-skeleton-line h-2 w-1/4 rounded-sm opacity-60" />
          </div>
        </div>
      ))}
    </div>
  )
}
