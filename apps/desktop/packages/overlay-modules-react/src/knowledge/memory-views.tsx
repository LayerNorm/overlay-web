'use client'

import type { MemoryRow } from '@overlay/app-core'
import { Trash2 } from 'lucide-react'
import { type MouseEvent } from 'react'

import { BulkSelectMarker } from './selection'

export function KnowledgeMemoryList({
  memories,
  selectedIds,
  selectMode,
  onOpen,
  onToggleSelect,
  onDelete,
}: {
  memories: readonly MemoryRow[]
  selectedIds: ReadonlySet<string>
  selectMode: boolean
  onOpen: (memory: MemoryRow) => void
  onToggleSelect: (memoryId: string) => void
  onDelete: (memoryId: string, event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-0.5">
      {memories.map((memory) => {
        const bulkSel = selectedIds.has(memory.memoryId)
        return (
          <div
            key={memory.key}
            role="button"
            tabIndex={0}
            onClick={() => (selectMode ? onToggleSelect(memory.memoryId) : onOpen(memory))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (selectMode) onToggleSelect(memory.memoryId)
                else onOpen(memory)
              }
            }}
            className={`group flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-muted)] ${
              bulkSel ? 'border-[var(--border)] bg-[var(--surface-muted)]' : ''
            }`}
          >
            {selectMode ? <BulkSelectMarker selected={bulkSel} className="mt-0.5 shrink-0" /> : null}
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--foreground)]">{memory.content}</p>
            {!selectMode ? (
              <button
                type="button"
                onClick={(event) => onDelete(memory.memoryId, event)}
                className="shrink-0 rounded p-1 text-[var(--muted-light)] opacity-0 transition-opacity hover:bg-[var(--surface-subtle)] hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function KnowledgeMemoryCards({
  memories,
  selectedIds,
  selectMode,
  onOpen,
  onToggleSelect,
}: {
  memories: readonly MemoryRow[]
  selectedIds: ReadonlySet<string>
  selectMode: boolean
  onOpen: (memory: MemoryRow) => void
  onToggleSelect: (memoryId: string) => void
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] columns-1 gap-4 [column-gap:1rem] sm:columns-2 lg:columns-3">
      {memories.map((memory) => {
        const bulkSel = selectedIds.has(memory.memoryId)
        return (
          <button
            key={memory.key}
            type="button"
            onClick={() => (selectMode ? onToggleSelect(memory.memoryId) : onOpen(memory))}
            className={`group relative mb-4 block w-full break-inside-avoid rounded-xl border bg-[var(--surface-elevated)] p-4 text-left transition-shadow hover:shadow-md ${
              bulkSel ? 'border-[var(--foreground)] ring-1 ring-[var(--foreground)]/20' : 'border-[var(--border)]'
            }`}
            style={{ breakInside: 'avoid' }}
          >
            {selectMode ? <BulkSelectMarker selected={bulkSel} className="absolute left-3 top-3 z-10" /> : null}
            <p className={`line-clamp-6 text-xs leading-relaxed text-[var(--foreground)] ${selectMode ? 'pl-7' : ''}`}>
              {memory.content}
            </p>
            <p className="mt-3 text-[10px] text-[var(--muted-light)]">
              {new Date(memory.createdAt).toLocaleDateString()}
            </p>
          </button>
        )
      })}
    </div>
  )
}
