'use client'

import type { KnowledgeFile,MemoryRow,OutputSummary } from '@overlay/app-core'
import type { TreeNode } from '@overlay/app-core/modules'
import { Badge,Button,EmptyState,TabButton,TabsList,cn } from '@overlay/ui'
import { type ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'

export interface KnowledgeModuleShellProps {
  title?: ReactNode
  activeTab: string
  tabs: readonly { id: string; label: ReactNode; disabled?: boolean }[]
  onTabChange?: (tabId: string) => void
  actions?: ReactNode
  children: ReactNode
}

export function KnowledgeModuleShell({
  title = 'Knowledge',
  activeTab,
  tabs,
  onTabChange,
  actions,
  children,
}: KnowledgeModuleShellProps) {
  return (
    <AppScreenShell
      header={
        <AppScreenHeader className="min-h-14 px-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              <TabsList>
                {tabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    active={tab.id === activeTab}
                    disabled={tab.disabled}
                    onClick={() => onTabChange?.(tab.id)}
                  >
                    {tab.label}
                  </TabButton>
                ))}
              </TabsList>
              {actions}
            </div>
          </div>
        </AppScreenHeader>
      }
    >
      <AppScreenBody padding="none" maxWidth="none">{children}</AppScreenBody>
    </AppScreenShell>
  )
}

export interface KnowledgeFileTreeProps {
  nodes: readonly TreeNode<KnowledgeFile>[]
  selectedId?: string | null
  loading?: boolean
  emptyLabel?: ReactNode
  onSelectFile?: (file: KnowledgeFile) => void
  renderActions?: (file: KnowledgeFile) => ReactNode
}

export function KnowledgeFileTree({
  nodes,
  selectedId,
  loading,
  emptyLabel = 'No files yet',
  onSelectFile,
  renderActions,
}: KnowledgeFileTreeProps) {
  if (loading) {
    return <div className="p-4 text-xs text-[var(--muted)]">Loading files...</div>
  }
  if (nodes.length === 0) {
    return <EmptyState className="h-full min-h-48" title={emptyLabel} />
  }
  return (
    <div className="py-2">
      {nodes.map((node) => (
        <KnowledgeFileTreeRow
          key={node.item._id}
          node={node}
          selectedId={selectedId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
        />
      ))}
    </div>
  )
}

function KnowledgeFileTreeRow({
  node,
  selectedId,
  onSelectFile,
  renderActions,
}: {
  node: TreeNode<KnowledgeFile>
  selectedId?: string | null
  onSelectFile?: (file: KnowledgeFile) => void
  renderActions?: (file: KnowledgeFile) => ReactNode
}) {
  const file = node.item
  const isFolder = file.kind === 'folder' || file.type === 'folder'
  return (
    <div>
      <div
        className={cn(
          'group/row flex min-h-9 items-center gap-2 px-3 text-sm transition-colors',
          selectedId === file._id
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]',
        )}
        style={{ paddingLeft: 12 + node.depth * 16 }}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => onSelectFile?.(file)}
        >
          <span className="mr-2 text-[10px] text-[var(--muted-light)]">{isFolder ? 'Folder' : 'File'}</span>
          {file.name}
        </button>
        {renderActions ? (
          <div className="hidden shrink-0 items-center gap-1 group-hover/row:flex">{renderActions(file)}</div>
        ) : null}
      </div>
      {node.children.map((child) => (
        <KnowledgeFileTreeRow
          key={child.item._id}
          node={child}
          selectedId={selectedId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
        />
      ))}
    </div>
  )
}

export interface OutputGalleryProps {
  outputs: readonly OutputSummary[]
  loading?: boolean
  onOpenOutput?: (output: OutputSummary) => void
  onDeleteOutput?: (output: OutputSummary) => void
}

export function OutputGallery({ outputs, loading, onOpenOutput, onDeleteOutput }: OutputGalleryProps) {
  if (loading) return <div className="p-4 text-xs text-[var(--muted)]">Loading outputs...</div>
  if (outputs.length === 0) return <EmptyState className="h-full min-h-48" title="No outputs yet" />
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {outputs.map((output) => (
        <article
          key={output._id}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{output.fileName ?? output.type}</p>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{output.prompt}</p>
            </div>
            <Badge variant={output.status === 'failed' ? 'danger' : output.status === 'pending' ? 'warning' : 'success'}>
              {output.status}
            </Badge>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenOutput?.(output)}>
              Open
            </Button>
            {onDeleteOutput ? (
              <Button size="sm" variant="ghost" onClick={() => onDeleteOutput(output)}>
                Delete
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}

export interface MemoryListProps {
  memories: readonly MemoryRow[]
  loading?: boolean
  selectedIds?: ReadonlySet<string>
  onToggleMemory?: (memory: MemoryRow) => void
}

export function MemoryList({ memories, loading, selectedIds, onToggleMemory }: MemoryListProps) {
  if (loading) return <div className="p-4 text-xs text-[var(--muted)]">Loading memories...</div>
  if (memories.length === 0) return <EmptyState className="h-full min-h-48" title="No memories yet" />
  return (
    <div className="divide-y divide-[var(--border)]">
      {memories.map((memory) => (
        <button
          key={memory.key}
          type="button"
          onClick={() => onToggleMemory?.(memory)}
          className={cn(
            'block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-subtle)]',
            selectedIds?.has(memory.memoryId) ? 'bg-[var(--surface-subtle)]' : '',
          )}
        >
          <p className="text-sm leading-6 text-[var(--foreground)]">{memory.content}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="muted">{memory.source}</Badge>
            {memory.status ? <Badge variant="muted">{memory.status}</Badge> : null}
          </div>
        </button>
      ))}
    </div>
  )
}
