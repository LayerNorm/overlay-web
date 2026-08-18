import { useState, useEffect, useMemo, useCallback, ReactElement } from 'react'
import { Brain, Trash2, X } from 'lucide-react'
import { CopyIcon } from '../components/icons'
import type { Theme } from '../utils/theme'
import { MEMORIES_CHANGED_EVENT } from '../services/desktop-sync-service'
import { desktopAppJson, unwrapPaginatedData } from '../services/app-api-client'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'

const DIALOG_ANIMATION_DURATION = 150

interface AddMemoryDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (text: string) => void
  isSaving: boolean
  theme: Theme
}

function AddMemoryDialog({
  isOpen,
  onClose,
  onSave,
  isSaving,
  theme
}: AddMemoryDialogProps): ReactElement<any> | null {
  const [text, setText] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!isOpen) setText('')
  }, [isOpen])

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    if (isOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => setIsAnimating(true))
    } else {
      setIsAnimating(false)
      timer = setTimeout(() => setShouldRender(false), DIALOG_ANIMATION_DURATION)
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isOpen])

  const handleSave = useCallback(() => {
    if (text.trim() && !isSaving) onSave(text.trim())
  }, [isSaving, onSave, text])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  if (!shouldRender) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        opacity: isAnimating ? 1 : 0,
        transition: `opacity ${DIALOG_ANIMATION_DURATION}ms ease-out`,
        overflow: 'hidden'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          padding: '32px',
          width: '520px',
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '20px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`,
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`
        }}
      >
        <h2
          style={{
            color: theme.text,
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
            lineHeight: '1.4',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}
        >
          Add Memory
        </h2>

        <div style={{ fontSize: '13px', color: theme.textSecondary, lineHeight: '1.5' }}>
          Paste text to add as memory. Large text will be automatically chunked into smaller pieces.
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste or type your text here..."
          autoFocus
          style={{
            width: '100%',
            minHeight: '200px',
            maxHeight: '400px',
            padding: '14px',
            borderRadius: '12px',
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            fontSize: '14px',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            lineHeight: '1.6',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s ease'
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.accent
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = theme.border
          }}
        />

        {text.trim() && (
          <div style={{ fontSize: '12px', color: theme.textSecondary, opacity: 0.7 }}>
            ~{Math.ceil(text.trim().length / 4)} tokens
            {text.trim().length > 2048 ? ' (will be chunked)' : ''}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', width: '100%', fontFamily: 'inherit' }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.5 : 1,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!isSaving) e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim() || isSaving}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: text.trim() && !isSaving ? theme.toggleThumb : theme.textDisabled,
              background: text.trim() && !isSaving ? theme.buttonBg : 'transparent',
              border: 'none',
              cursor: text.trim() && !isSaving ? 'pointer' : 'not-allowed',
              opacity: text.trim() && !isSaving ? 1 : 0.5,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (text.trim() && !isSaving) e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              if (text.trim() && !isSaving) e.currentTarget.style.background = theme.buttonBg
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface StoredMemory {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance: number
  source: {
    chatId: string
    messageId?: string
    folderId?: string
    noteId?: string
  }
  createdAt: number
  accessCount: number
  lastAccessedAt: number
}

interface RemoteMemory {
  _id: string
  content: string
  source?: 'chat' | 'note' | 'manual'
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  conversationId?: string
  messageId?: string
  noteId?: string
  projectId?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

const typeColors: Record<string, string> = {
  preference: '#8b5cf6',
  fact: '#3b82f6',
  project: '#f59e0b',
  decision: '#10b981',
  agent: '#f97316'
}

interface MemoryListPageProps {
  theme: Theme
  isSearchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  isSelectMode: boolean
  onSelectModeChange: (value: boolean) => void
  showAddDialog: boolean
  onAddDialogOpenChange: (value: boolean) => void
  loadFromBackend?: boolean
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

export function MemoryListPage({
  theme,
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  isSelectMode,
  onSelectModeChange,
  showAddDialog,
  onAddDialogOpenChange,
  loadFromBackend = false
}: MemoryListPageProps): ReactElement<any> {
  const [memories, setMemories] = useState<StoredMemory[]>([])
  const [isSavingMemory, setIsSavingMemory] = useState(false)
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadMemories = useCallback(async (): Promise<void> => {
    try {
      if (loadFromBackend) {
        const remote = await desktopAppJson<RemoteMemory[] | { data: RemoteMemory[] }>('/api/v1/memory?raw=true')
        const remoteMemories = unwrapPaginatedData<RemoteMemory>(remote)
        setMemories(
          remoteMemories
            .filter((memory) => !memory.deletedAt)
            .map((memory) => ({
              id: memory._id,
              content: memory.content,
              type: memory.type || 'fact',
              importance: memory.importance ?? 0.5,
              source: {
                chatId: memory.conversationId || '',
                messageId: memory.messageId,
                folderId: memory.projectId,
                noteId: memory.noteId
              },
              createdAt: memory.createdAt,
              accessCount: 0,
              lastAccessedAt: memory.updatedAt || memory.createdAt
            }))
        )
        return
      }
      const all = await window.bridge.memory.getAll()
      setMemories(all)
    } catch (err) {
      console.error('[MemoryListPage] Failed to load memories:', err)
    }
  }, [loadFromBackend])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  useEffect(() => {
    const handler = (): void => {
      void loadMemories()
    }
    window.addEventListener(MEMORIES_CHANGED_EVENT, handler)
    return () => window.removeEventListener(MEMORIES_CHANGED_EVENT, handler)
  }, [loadMemories])

  useEffect(() => {
    if (!isSelectMode) setSelectedMemoryIds(new Set())
  }, [isSelectMode])

  const handleAddMemory = useCallback(
    async (text: string): Promise<void> => {
      setIsSavingMemory(true)
      try {
        if (loadFromBackend) {
          await desktopAppJson('/api/v1/memory', {
            method: 'POST',
            body: JSON.stringify({
              content: text,
              source: 'manual',
              type: 'fact',
              importance: 0.5
            })
          })
        } else {
          await window.bridge.memory.add({
            content: text,
            type: 'fact',
            importance: 0.5,
            source: { chatId: 'manual-import' }
          })
        }
        await loadMemories()
        onAddDialogOpenChange(false)
      } catch (err) {
        console.error('[MemoryListPage] Failed to add memory:', err)
      } finally {
        setIsSavingMemory(false)
      }
    },
    [loadFromBackend, loadMemories, onAddDialogOpenChange]
  )

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (loadFromBackend) {
        await desktopAppJson(`/api/v1/memory?memoryId=${encodeURIComponent(id)}`, {
          method: 'DELETE'
        })
      } else {
        await window.bridge.memory.delete(id)
      }
      setMemories((prev) => prev.filter((m) => m.id !== id))
    },
    [loadFromBackend]
  )

  const handleCopy = useCallback((memory: StoredMemory, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(memory.content)
    setCopiedId(memory.id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const toggleSelection = useCallback((id: string) => {
    setSelectedMemoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    onSelectModeChange(false)
    setSelectedMemoryIds(new Set())
  }, [onSelectModeChange])

  const handleBatchDelete = useCallback(() => {
    const idsToDelete = new Set(selectedMemoryIds)
    setMemories((prev) => prev.filter((m) => !idsToDelete.has(m.id)))
    exitSelectMode()
    if (loadFromBackend) {
      Promise.all(
        Array.from(idsToDelete).map((id) =>
          desktopAppJson(`/api/v1/memory?memoryId=${encodeURIComponent(id)}`, {
            method: 'DELETE'
          })
        )
      ).catch((err) => {
        console.error('[Memory] Backend batch delete failed:', err)
      })
    } else {
      window.bridge.memory.deleteMany(Array.from(idsToDelete)).catch((err) => {
        console.error('[Memory] Batch delete failed:', err)
      })
    }
  }, [exitSelectMode, loadFromBackend, selectedMemoryIds])

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories
    const q = searchQuery.toLowerCase()
    return memories.filter((memory) => memory.content.toLowerCase().includes(q))
  }, [memories, searchQuery])

  const groups = useMemo(() => {
    const sorted = [...filteredMemories].sort((a, b) => b.createdAt - a.createdAt)
    const byLabel: Record<string, StoredMemory[]> = {}
    for (const m of sorted) {
      const label = getDateLabel(m.createdAt)
      ;(byLabel[label] ||= []).push(m)
    }
    return byLabel
  }, [filteredMemories])

  const groupLabels = useMemo(() => Object.keys(groups), [groups])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {isSearchOpen && (
        <div style={{ padding: '6px 8px', flexShrink: 0 }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search memories..."
            style={{
              width: '100%',
              padding: '5px 10px',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              color: theme.text,
              fontSize: '12px',
              outline: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {isSelectMode && selectedMemoryIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            {selectedMemoryIds.size} selected
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handleBatchDelete}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '3px 8px',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '5px',
                color: 'rgb(239,68,68)',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <Trash2 size={11} /> Delete
            </button>
            <button
              onClick={exitSelectMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 6px',
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '5px',
                color: theme.textSecondary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 8px 8px'
        }}
      >
        {filteredMemories.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary
            }}
          >
            <Brain size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {searchQuery ? 'No results' : 'No memories yet'}
            </span>
          </div>
        ) : (
          <>
            {groupLabels.map((dateLabel, groupIdx) => {
              const items = groups[dateLabel]
              if (!items || items.length === 0) return null
              return (
                <div key={dateLabel}>
                  {groupIdx > 0 && (
                    <div style={{ height: '1px', background: theme.border, margin: '6px 0' }} />
                  )}
                  <div
                    style={{
                      fontSize: '10px',
                      color: theme.textSecondary,
                      padding: '4px 10px 2px',
                      opacity: 0.6,
                      letterSpacing: '0.3px'
                    }}
                  >
                    {dateLabel}
                  </div>
                  {items.map((memory) => {
                    const isSelected = selectedMemoryIds.has(memory.id)
                    const isCopied = copiedId === memory.id

                    return (
                      <SidebarListItem
                        key={memory.id}
                        label={memory.content}
                        isSelectMode={isSelectMode}
                        isBatchSelected={isSelected}
                        onBatchToggle={() => toggleSelection(memory.id)}
                        theme={theme}
                        leading={
                          <div
                            style={{
                              fontSize: '10px',
                              fontWeight: 500,
                              color: typeColors[memory.type] || theme.textSecondary,
                              background: `${typeColors[memory.type] || theme.textSecondary}18`,
                              padding: '1px 5px',
                              borderRadius: '3px',
                              flexShrink: 0,
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                              lineHeight: '16px'
                            }}
                          >
                            {memory.type}
                          </div>
                        }
                        actions={
                          <>
                            {isCopied ? (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#22c55e"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <SidebarItemAction
                                onClick={(e) => handleCopy(memory, e)}
                                title="Copy"
                                icon={CopyIcon}
                                color={theme.textSecondary}
                              />
                            )}
                            <SidebarItemAction
                              onClick={(e) => handleDelete(memory.id, e)}
                              title="Delete"
                              icon={Trash2}
                              color={theme.textSecondary}
                            />
                          </>
                        }
                      />
                    )
                  })}
                </div>
              )
            })}
          </>
        )}
      </div>

      <AddMemoryDialog
        isOpen={showAddDialog}
        onClose={() => onAddDialogOpenChange(false)}
        onSave={(text) => {
          void handleAddMemory(text)
        }}
        isSaving={isSavingMemory}
        theme={theme}
      />
    </div>
  )
}
