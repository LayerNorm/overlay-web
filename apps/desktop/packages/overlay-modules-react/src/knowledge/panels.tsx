'use client'

import type { KnowledgeFileNode,MemoryRow } from '@overlay/app-core'
import { FileTreeSkeleton,KnowledgeListSkeleton } from '@overlay/ui'
import { type ChangeEvent,type MouseEvent,type RefObject } from 'react'

import { KnowledgeEmptyState } from './dialogs'
import { KnowledgeFileCards,KnowledgeFileCardsSkeleton,KnowledgeFileList } from './file-views'
import { KnowledgeMemoryCards,KnowledgeMemoryList } from './memory-views'

export function KnowledgeFilesPanel({
  loading,
  filesCount,
  nodes,
  folders,
  flatFiles,
  allFiles,
  layout,
  selectedFileId,
  selectedIds,
  selectMode,
  onCreateFirstMemory,
  onSelect,
  onFolderOpen,
  onDelete,
  onToggleBulk,
  onMove,
}: {
  loading: boolean
  filesCount: number
  nodes: readonly KnowledgeFileNode[]
  folders: readonly KnowledgeFileNode[]
  flatFiles: readonly KnowledgeFileNode[]
  allFiles: readonly KnowledgeFileNode[]
  layout: 'list' | 'cards'
  selectedFileId: string | null
  selectedIds: ReadonlySet<string>
  selectMode: boolean
  onCreateFirstMemory?: () => void
  onSelect: (node: KnowledgeFileNode) => void
  onFolderOpen: (folderId: string) => void
  onDelete: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  onToggleBulk: (id: string) => void
  onMove: (fileId: string, parentId: string | null) => void
}) {
  void onCreateFirstMemory
  if (loading) {
    return layout === 'cards' ? <KnowledgeFileCardsSkeleton /> : <FileTreeSkeleton rows={10} />
  }
  if (filesCount === 0) return <KnowledgeEmptyState kind="file" message="No files yet" />
  if (nodes.length === 0) return <KnowledgeEmptyState kind="search" message="No files match your search" />
  if (layout === 'list') {
    return (
      <KnowledgeFileList
        nodes={nodes}
        selectedId={selectedFileId}
        selectedIds={selectedIds}
        selectMode={selectMode}
        onSelect={onSelect}
        onFolderOpen={onFolderOpen}
        onDelete={onDelete}
        onToggleBulk={onToggleBulk}
        onMove={onMove}
      />
    )
  }
  return (
    <KnowledgeFileCards
      folders={folders}
      files={flatFiles}
      allFiles={allFiles}
      selectedIds={selectedIds}
      selectMode={selectMode}
      onOpenFolder={onFolderOpen}
      onOpenFile={onSelect}
      onToggleBulk={onToggleBulk}
      onMove={onMove}
    />
  )
}

export function KnowledgeMemoriesPanel({
  loading,
  memoriesCount,
  memories,
  layout,
  selectedIds,
  selectMode,
  hasPending,
  onOpen,
  onToggleSelect,
  onDelete,
  onAddFirst,
}: {
  loading: boolean
  memoriesCount: number
  memories: readonly MemoryRow[]
  layout: 'list' | 'cards'
  selectedIds: ReadonlySet<string>
  selectMode: boolean
  hasPending: boolean
  onOpen: (memory: MemoryRow) => void
  onToggleSelect: (memoryId: string) => void
  onDelete: (memoryId: string, event: MouseEvent<HTMLButtonElement>) => void
  onAddFirst: () => void
}) {
  if (loading) return <KnowledgeListSkeleton rows={10} />
  if (memoriesCount === 0 && !hasPending) {
    return (
      <KnowledgeEmptyState
        kind="memory"
        message="No memories yet"
        actionLabel="Add your first memory"
        onAction={onAddFirst}
      />
    )
  }
  if (memoriesCount > 0 && memories.length === 0) {
    return <KnowledgeEmptyState kind="search" message="No memories match your search" />
  }
  if (layout === 'list') {
    return (
      <KnowledgeMemoryList
        memories={memories}
        selectedIds={selectedIds}
        selectMode={selectMode}
        onOpen={onOpen}
        onToggleSelect={onToggleSelect}
        onDelete={onDelete}
      />
    )
  }
  return (
    <KnowledgeMemoryCards
      memories={memories}
      selectedIds={selectedIds}
      selectMode={selectMode}
      onOpen={onOpen}
      onToggleSelect={onToggleSelect}
    />
  )
}

export function HiddenKnowledgeFileInputs({
  fileUploadRef,
  folderUploadRef,
  onFileChange,
  onFolderChange,
}: {
  fileUploadRef: RefObject<HTMLInputElement | null>
  folderUploadRef: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onFolderChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <input ref={fileUploadRef} type="file" className="hidden" onChange={onFileChange} />
      <input
        ref={folderUploadRef}
        type="file"
        className="hidden"
        onChange={onFolderChange}
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
      />
    </>
  )
}
