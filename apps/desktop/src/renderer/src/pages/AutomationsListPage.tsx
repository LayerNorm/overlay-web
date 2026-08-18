import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Trash2, Workflow, X } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { desktopAppJson, unwrapPaginatedData } from '../services/app-api-client'

export const AUTOMATIONS_UPDATED_EVENT = 'overlay:automations-updated'

export type Automation = {
  _id: string
  name?: string
  title?: string
  enabled?: boolean
  createdAt?: number
  sourceConversationId?: string
  conversationId?: string
  nextRunAt?: number
  lastError?: string
}

interface AutomationsListPageProps {
  theme: Theme
  onSelectAutomation?: (automation: Automation) => void
  selectedAutomationId?: string | null
  selectedConversationId?: string | null
  refreshToken?: number
}

function automationLabel(automation: Automation): string {
  return automation.name || automation.title || 'Untitled automation'
}

function automationConversationId(automation: Automation): string | undefined {
  return automation.sourceConversationId || automation.conversationId
}

function statusLabel(automation: Automation): string {
  if (automation.lastError) return 'Error'
  return automation.enabled === false ? 'Paused' : 'Enabled'
}

function statusColor(automation: Automation, theme: Theme): string {
  if (automation.lastError) return '#ef4444'
  if (automation.enabled === false) return theme.textSecondary
  return '#22c55e'
}

export function AutomationsListPage({
  theme,
  onSelectAutomation,
  selectedAutomationId,
  selectedConversationId,
  refreshToken = 0
}: AutomationsListPageProps): React.ReactElement<any> {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [pendingNavId, setPendingNavId] = useState<string | null>(null)

  const loadAutomations = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await desktopAppJson<Automation[] | { data: Automation[] }>('/api/v1/automations')
      setAutomations(unwrapPaginatedData<Automation>(data))
    } catch (error) {
      console.error('[AutomationsListPage] Failed to load automations:', error)
      setLoadError('Failed to load automations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAutomations()
  }, [loadAutomations, refreshToken])

  useEffect(() => {
    const handleUpdated = (): void => {
      void loadAutomations()
    }
    window.addEventListener(AUTOMATIONS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(AUTOMATIONS_UPDATED_EVENT, handleUpdated)
  }, [loadAutomations])

  const sortedAutomations = useMemo(() => {
    return [...automations].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [automations])

  const beginRename = useCallback((automation: Automation, event: React.MouseEvent) => {
    event.stopPropagation()
    setConfirmDeleteId(null)
    setEditingId(automation._id)
    setEditingName(automationLabel(automation))
  }, [])

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditingName('')
  }, [])

  const commitRename = useCallback(
    async (automation: Automation): Promise<void> => {
      const nextName = editingName.trim()
      const previousName = automationLabel(automation)
      if (!nextName || nextName === previousName) {
        cancelRename()
        return
      }

      setAutomations((prev) =>
        prev.map((item) => (item._id === automation._id ? { ...item, name: nextName } : item))
      )
      cancelRename()

      try {
        await desktopAppJson('/api/v1/automations', {
          method: 'PATCH',
          body: JSON.stringify({ automationId: automation._id, name: nextName })
        })
        window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      } catch (error) {
        console.error('[AutomationsListPage] Failed to rename automation:', error)
        setAutomations((prev) =>
          prev.map((item) => (item._id === automation._id ? { ...item, name: previousName } : item))
        )
      }
    },
    [cancelRename, editingName]
  )

  const deleteAutomation = useCallback(async (automation: Automation, event: React.MouseEvent) => {
    event.stopPropagation()
    setConfirmDeleteId(null)
    setDeletingIds((prev) => new Set(prev).add(automation._id))
    try {
      await desktopAppJson(
        `/api/v1/automations?automationId=${encodeURIComponent(automation._id)}`,
        { method: 'DELETE' }
      )
      setAutomations((prev) => prev.filter((item) => item._id !== automation._id))
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
    } catch (error) {
      console.error('[AutomationsListPage] Failed to delete automation:', error)
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(automation._id)
        return next
      })
    }
  }, [])

  const selectAutomation = useCallback(
    async (automation: Automation): Promise<void> => {
      if (editingId === automation._id) return
      setPendingNavId(automation._id)
      try {
        await desktopAppJson(
          `/api/v1/automations?automationId=${encodeURIComponent(automation._id)}`
        ).catch(() => null)
        onSelectAutomation?.(automation)
      } finally {
        setPendingNavId(null)
      }
    },
    [editingId, onSelectAutomation]
  )

  if (loading) {
    return (
      <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            style={{
              height: 28,
              borderRadius: 7,
              background: theme.surface,
              opacity: 0.55
            }}
          />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ padding: '14px', color: theme.textSecondary, fontSize: 12 }}>{loadError}</div>
    )
  }

  if (sortedAutomations.length === 0) {
    return (
      <div
        style={{
          padding: '14px',
          color: theme.textSecondary,
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        No automations yet
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {sortedAutomations.map((automation) => {
        const conversationId = automationConversationId(automation)
        const active =
          selectedAutomationId === automation._id ||
          Boolean(conversationId && selectedConversationId === conversationId)
        const hovered = hoveredId === automation._id
        const isEditing = editingId === automation._id
        const isDeleting = deletingIds.has(automation._id)
        const isConfirmingDelete = confirmDeleteId === automation._id
        return (
          <div
            key={automation._id}
            title={automation.lastError || statusLabel(automation)}
            onMouseEnter={() => setHoveredId(automation._id)}
            onMouseLeave={() => {
              setHoveredId(null)
              if (isConfirmingDelete) setConfirmDeleteId(null)
            }}
            style={{
              height: 28,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              boxSizing: 'border-box',
              background: active ? theme.selectionBg : hovered ? theme.buttonHover : 'transparent',
              color: active ? theme.text : theme.textSecondary,
              transition: 'background 0.12s ease, color 0.12s ease'
            }}
          >
            <button
              type="button"
              disabled={isDeleting || pendingNavId === automation._id}
              onClick={() => void selectAutomation(automation)}
              style={{
                minWidth: 0,
                flex: 1,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                padding: 0,
                cursor: isDeleting ? 'default' : 'pointer',
                textAlign: 'left',
                opacity: isDeleting ? 0.45 : 1
              }}
            >
              {pendingNavId === automation._id ? (
                <Loader2 size={13} className="animate-spin" color={theme.textSecondary} />
              ) : (
                <Workflow size={13} strokeWidth={1.75} color={statusColor(automation, theme)} />
              )}
              {isEditing ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void commitRename(automation)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={() => void commitRename(automation)}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    height: 24,
                    borderRadius: 6,
                    border: `1px solid ${theme.border}`,
                    background: theme.background,
                    color: theme.text,
                    outline: 'none',
                    padding: '0 7px',
                    fontSize: 12
                  }}
                />
              ) : (
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    lineHeight: '18px'
                  }}
                >
                  {automationLabel(automation)}
                </span>
              )}
            </button>

            {!isEditing && isConfirmingDelete ? (
              <button
                type="button"
                onClick={(event) => void deleteAutomation(automation, event)}
                disabled={isDeleting}
                style={{
                  height: 22,
                  border: 'none',
                  borderRadius: 999,
                  padding: '0 8px',
                  background: 'rgba(239,68,68,0.16)',
                  color: '#ef4444',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Confirm
              </button>
            ) : !isEditing ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  opacity: hovered || active ? 1 : 0,
                  transition: 'opacity 0.12s ease'
                }}
              >
                <button
                  type="button"
                  onClick={(event) => beginRename(automation, event)}
                  disabled={isDeleting}
                  aria-label="Rename automation"
                  style={{
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    borderRadius: 5,
                    background: 'transparent',
                    color: theme.textSecondary,
                    cursor: 'pointer'
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setConfirmDeleteId(automation._id)
                  }}
                  disabled={isDeleting}
                  aria-label="Delete automation"
                  style={{
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    borderRadius: 5,
                    background: 'transparent',
                    color: theme.textSecondary,
                    cursor: 'pointer'
                  }}
                >
                  {isDeleting ? <X size={11} /> : <Trash2 size={11} />}
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
