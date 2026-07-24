import { useState, useEffect, useMemo, useCallback, ReactElement } from 'react'
import { useTranscriptions } from '../hooks/useTranscriptions'
import { Transcription } from '../../../types/transcription'
import { CopyIcon } from '../components/icons'
import type { Theme } from '../utils/theme'
import { Mic, Trash2, X } from 'lucide-react'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'

const TRANSCRIPTIONS_STORAGE_KEY = 'transcriptions'

interface TranscriptionListPageProps {
  theme: Theme
  isSearchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  isSelectMode: boolean
  onSelectModeChange: (value: boolean) => void
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

export function TranscriptionListPage({
  theme,
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  isSelectMode,
  onSelectModeChange
}: TranscriptionListPageProps): ReactElement {
  const { transcriptions } = useTranscriptions()
  const [localTranscriptions, setLocalTranscriptions] = useState<Transcription[]>(transcriptions)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLocalTranscriptions(transcriptions)
  }, [transcriptions])

  useEffect(() => {
    if (!isSelectMode) setSelectedIds(new Set())
  }, [isSelectMode])

  const deleteIds = useCallback((ids: Set<string>) => {
    setLocalTranscriptions((prev) => {
      const next = prev.filter((t) => !ids.has(t.id))
      localStorage.setItem(TRANSCRIPTIONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const validTranscriptions = useMemo(
    () => localTranscriptions.filter((t) => t.text && t.text.trim().length > 0),
    [localTranscriptions]
  )

  const filteredTranscriptions = useMemo(() => {
    if (!searchQuery.trim()) return validTranscriptions
    const q = searchQuery.toLowerCase()
    return validTranscriptions.filter((t) => t.text.toLowerCase().includes(q))
  }, [searchQuery, validTranscriptions])

  const groups = useMemo(() => {
    const sorted = [...filteredTranscriptions].sort((a, b) => b.timestamp - a.timestamp)
    const byLabel: Record<string, Transcription[]> = {}
    for (const t of sorted) {
      const label = getDateLabel(t.timestamp)
      ;(byLabel[label] ||= []).push(t)
    }
    return byLabel
  }, [filteredTranscriptions])

  const groupLabels = useMemo(() => Object.keys(groups), [groups])

  const handleCopy = useCallback((t: Transcription) => {
    navigator.clipboard.writeText(t.text)
    setCopiedId(t.id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    onSelectModeChange(false)
    setSelectedIds(new Set())
  }, [onSelectModeChange])

  const handleBatchDelete = useCallback(() => {
    deleteIds(selectedIds)
    exitSelectMode()
  }, [deleteIds, exitSelectMode, selectedIds])

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
            placeholder="Search voice..."
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

      {isSelectMode && selectedIds.size > 0 && (
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
            {selectedIds.size} selected
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
        {filteredTranscriptions.length === 0 ? (
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
            <Mic size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {searchQuery ? 'No results' : 'No transcriptions yet'}
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
                  {items.map((t) => {
                    const isSelected = selectedIds.has(t.id)
                    const isCopied = copiedId === t.id

                    return (
                      <SidebarListItem
                        key={t.id}
                        icon={Mic}
                        label={t.text}
                        isSelectMode={isSelectMode}
                        isBatchSelected={isSelected}
                        onBatchToggle={() => toggleSelection(t.id)}
                        onClick={() => handleCopy(t)}
                        theme={theme}
                        actions={
                          isCopied ? (
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
                              onClick={() => handleCopy(t)}
                              title="Copy"
                              icon={CopyIcon}
                              color={theme.textSecondary}
                            />
                          )
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
    </div>
  )
}
