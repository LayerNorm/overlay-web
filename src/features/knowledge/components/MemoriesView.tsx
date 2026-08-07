'use client'

// Compatibility wrapper: memory contracts/controllers are shared through @overlay/app-core,
// with typed transport in @overlay/api-client.
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { Brain, CheckSquare, Copy, Loader2, Plus, Square, Trash2, X } from 'lucide-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { MemoriesLoadingState } from './MemoriesLoadingState'

interface MemoryListItem {
  key: string
  memoryId: string
  segmentIndex: number
  content: string
  fullContent: string
  source: string
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: 'user' | 'agent'
  createdAt: number
  updatedAt?: number
}

interface Memory {
  memoryId: string
  content: string
  source: string
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags: string[]
  actor?: 'user' | 'agent'
  createdAt: number
  updatedAt?: number
}

function uniqueMemoriesFromRows(rows: MemoryListItem[]): Memory[] {
  const seen = new Set<string>()
  const out: Memory[] = []
  for (const row of rows) {
    if (seen.has(row.memoryId)) continue
    seen.add(row.memoryId)
    out.push({
      memoryId: row.memoryId,
      content: row.fullContent,
      source: row.source,
      type: row.type,
      importance: row.importance,
      projectId: row.projectId,
      conversationId: row.conversationId,
      noteId: row.noteId,
      messageId: row.messageId,
      turnId: row.turnId,
      tags: row.tags ?? [],
      actor: row.actor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
  return out
}

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getBadgeTone(kind: string): string {
  void kind
  return 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]'
}

interface MemoriesHeaderState {
  count: number
  actions: ReactNode
}

interface MemoriesViewProps {
  userId: string
  onHeaderStateChange?: (state: MemoriesHeaderState | null) => void
}

export default function MemoriesView({ userId: _userId, onHeaderStateChange }: MemoriesViewProps) {
  void _userId
  const [memories, setMemories] = useState<Memory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addText, setAddText] = useState('')
  const [addType, setAddType] = useState<Memory['type']>('fact')
  const [addImportance, setAddImportance] = useState('3')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingSavePreview, setPendingSavePreview] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const actionButtonClass =
    'flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]'
  const dialogButtonClass =
    'rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]'
  const metaChipClass =
    'rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]'

  const loadMemories = useCallback(async () => {
    try {
      const res = await overlayAppClient.memory.getResponse({ limit: 100 })
      if (res.ok) {
        const rows = unwrapPaginatedData<MemoryListItem>(await res.json())
        setMemories(uniqueMemoriesFromRows(rows))
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  async function handleAdd() {
    const text = addText.trim()
    if (!text || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    const preview = text.length > 160 ? `${text.slice(0, 160)}…` : text
    setPendingSavePreview(preview)
    try {
      const res = await overlayAppClient.memory.createResponse({
        content: text,
        source: 'manual',
        type: addType,
        importance: Number(addImportance) || 3,
        actor: 'user',
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setSaveError(typeof data?.error === 'string' ? data.error : 'Could not save memory')
        return
      }
      setAddText('')
      setAddType('fact')
      setAddImportance('3')
      setShowAdd(false)
      await loadMemories()
    } finally {
      setPendingSavePreview(null)
      setIsSaving(false)
    }
  }

  async function handleDelete(memoryId: string) {
    await overlayAppClient.memory.deleteResponse({ memoryId })
    setMemories((prev) => prev.filter((memory) => memory.memoryId !== memoryId))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(memoryId)
      return next
    })
  }

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => overlayAppClient.memory.deleteResponse({ memoryId: id })))
    setMemories((prev) => prev.filter((memory) => !selectedIds.has(memory.memoryId)))
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [selectedIds])

  async function handleCopy(memory: Memory) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    await navigator.clipboard.writeText(memory.content)
  }

  function toggleSelected(memoryId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(memoryId)) next.delete(memoryId)
      else next.add(memoryId)
      return next
    })
  }

  const headerActions = useMemo(() => (
    <>
      <button
        onClick={() => {
          setSelectionMode((value) => !value)
          setSelectedIds(new Set())
        }}
        className={`flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs transition-colors ${
          selectionMode
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'bg-[var(--surface-elevated)] text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
        }`}
      >
        <CheckSquare size={12} />
        {selectionMode ? 'Done' : 'Select'}
      </button>
      {selectionMode && selectedIds.size > 0 && (
        <button
          onClick={() => void handleBulkDelete()}
          className="flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/15"
        >
          <Trash2 size={12} />
          Delete {selectedIds.size}
        </button>
      )}
      <button
        onClick={() => { setShowAdd(true); setSaveError(null) }}
        className={actionButtonClass}
      >
        <Plus size={12} />
        Add memory
      </button>
    </>
  ), [actionButtonClass, handleBulkDelete, selectedIds.size, selectionMode])

  useEffect(() => {
    if (!onHeaderStateChange) return
    onHeaderStateChange({ count: memories.length, actions: headerActions })
    return () => onHeaderStateChange(null)
  }, [headerActions, memories.length, onHeaderStateChange])

  const groups: Record<string, Memory[]> = {}
  for (const memory of memories) {
    const label = getDateLabel(memory.createdAt)
    ;(groups[label] ||= []).push(memory)
  }
  const groupLabels = Object.keys(groups)

  return (
    <div className="flex h-full flex-col">
      {!onHeaderStateChange ? (
        <div className="flex h-16 items-center justify-between border-b border-[var(--border)] px-6">
          <h2 className="text-sm font-medium text-[var(--foreground)]">
            Memories
            {memories.length > 0 && (
              <span className="ml-2 text-xs font-normal text-[var(--muted-light)]">{memories.length}</span>
            )}
          </h2>
          <div className="flex items-center gap-2">{headerActions}</div>
        </div>
      ) : null}

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowAdd(false)
          }}
        >
          <div className="w-[520px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--foreground)]">Add memory</h3>
              <button
                onClick={() => { setShowAdd(false); setSaveError(null) }}
                className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <X size={14} />
              </button>
            </div>
            <textarea
              value={addText}
              onChange={(event) => setAddText(event.target.value)}
              placeholder="Type or paste memory content..."
              autoFocus
              rows={5}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.metaKey) void handleAdd()
              }}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-light)] focus:border-[var(--muted)]"
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs text-[var(--muted)]">
                Type
                <select
                  value={addType ?? 'fact'}
                  onChange={(event) => setAddType(event.target.value as Memory['type'])}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="project">Project</option>
                  <option value="decision">Decision</option>
                  <option value="agent">Agent</option>
                </select>
              </label>
              <label className="text-xs text-[var(--muted)]">
                Importance
                <select
                  value={addImportance}
                  onChange={(event) => setAddImportance(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              Saved memories stay as a single record, but the knowledge sidebar can still preview
              them in short segments for easier scanning.
            </p>
            {saveError ? (
              <p className="mt-3 text-xs text-red-400" role="alert">
                {saveError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowAdd(false); setSaveError(null) }}
                className={dialogButtonClass}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={!addText.trim() || isSaving}
                className={`${dialogButtonClass} disabled:opacity-40`}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <MemoriesLoadingState />
        ) : memories.length === 0 && !pendingSavePreview ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted)]">
            <Brain size={40} strokeWidth={1} className="opacity-40" />
            <p className="text-sm">No memories yet</p>
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs text-[var(--foreground)] underline underline-offset-2 transition-colors"
            >
              Add your first memory
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-4">
            {pendingSavePreview ? (
              <div
                className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3"
                aria-busy
                aria-live="polite"
              >
                <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-[var(--muted)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--foreground)]">Saving memory…</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                    {pendingSavePreview}
                  </p>
                </div>
              </div>
            ) : null}
            {groupLabels.map((label) => (
              <div key={label}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">
                  {label}
                </p>
                <div className="space-y-2">
                  {groups[label].map((memory) => {
                    const isSelected = selectedIds.has(memory.memoryId)
                    return (
                      <div
                        key={memory.memoryId}
                        className={`group rounded-xl border px-3 py-3 transition-colors ${
                          isSelected
                            ? 'border-[var(--border)] bg-[var(--surface-subtle)]'
                            : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-muted)]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {selectionMode && (
                            <button
                              type="button"
                              onClick={() => toggleSelected(memory.memoryId)}
                              className="mt-0.5 shrink-0 text-[var(--muted)]"
                            >
                              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
                              {memory.content}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {memory.type && (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${getBadgeTone(memory.type)}`}>
                                  {memory.type}
                                </span>
                              )}
                              <span className={metaChipClass}>
                                {memory.source}
                              </span>
                              {typeof memory.importance === 'number' && (
                                <span className={metaChipClass}>
                                  importance {memory.importance}
                                </span>
                              )}
                              {memory.actor && (
                                <span className={metaChipClass}>
                                  {memory.actor}
                                </span>
                              )}
                              {memory.projectId && (
                                <span className={metaChipClass}>
                                  project
                                </span>
                              )}
                              {memory.conversationId && (
                                <span className={metaChipClass}>
                                  chat
                                </span>
                              )}
                              {memory.noteId && (
                                <span className={metaChipClass}>
                                  note
                                </span>
                              )}
                              {memory.tags.map((tag) => (
                                <span
                                  key={`${memory.memoryId}:${tag}`}
                                  className={metaChipClass}
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-light)]">
                              <span>
                                {new Date(memory.createdAt).toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {memory.updatedAt && memory.updatedAt !== memory.createdAt && (
                                <span>
                                  updated{' '}
                                  {new Date(memory.updatedAt).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                          {!selectionMode && (
                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={() => void handleCopy(memory)}
                                className="rounded p-1 transition-colors hover:bg-[var(--surface-subtle)]"
                                title="Copy memory"
                              >
                                <Copy size={13} className="text-[var(--muted)]" />
                              </button>
                              <button
                                onClick={() => void handleDelete(memory.memoryId)}
                                className="rounded p-1 transition-colors hover:bg-red-500/10"
                                title="Delete memory"
                              >
                                <Trash2 size={13} className="text-red-400" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
