'use client'

import { useState, useCallback, useEffect, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { dispatchChatDeleted } from '@/shared/chat/chat-title'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { AutomationSummary } from '@overlay/app-core'
import type { DeleteAutomationResponse } from '@overlay/app-core/automations'
import {
  applyAutomationRename,
  AUTOMATIONS_UPDATED_EVENT,
  getAutomationDisplayName,
  removeAutomationById,
} from '@overlay/app-core/automations'
import { AutomationsInlineList } from '@overlay/modules-react/automations'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'

const INITIAL_SIDEBAR_LIST_LIMIT = 24

export function AutomationsInlinePanel({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [automations, setAutomations] = useState<AutomationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null)
  const [editingAutomationName, setEditingAutomationName] = useState('')
  const [pendingDeleteAutomationId, setPendingDeleteAutomationId] = useState<string | null>(null)
  const [deletingAutomationIds, setDeletingAutomationIds] = useState<string[]>([])
  const [pendingNavId, setPendingNavId] = useState<string | null>(null)
  const activeId = searchParams?.get('id') ?? null
  const activeAutomationId = searchParams?.get('automationId') ?? null

  const loadAutomations = useCallback(async () => {
    try {
      const page = await overlayAppClient.automations.getPage<AutomationSummary>({
        limit: INITIAL_SIDEBAR_LIST_LIMIT,
      })
      setAutomations(Array.isArray(page.data) ? page.data : [])
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  async function loadMoreAutomations() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await overlayAppClient.automations.getPage<AutomationSummary>({
        cursor: nextCursor,
        limit: INITIAL_SIDEBAR_LIST_LIMIT,
      })
      setAutomations((current) => {
        const byId = new Map(current.map((automation) => [automation._id, automation]))
        for (const automation of Array.isArray(page.data) ? page.data : []) {
          byId.set(automation._id, automation)
        }
        return [...byId.values()]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadAutomations()
  }, [loadAutomations])

  useWorkspaceChanged(loadAutomations)

  useEffect(() => {
    function handleAutomationsUpdated() {
      setLoading(true)
      void loadAutomations()
    }
    window.addEventListener(AUTOMATIONS_UPDATED_EVENT, handleAutomationsUpdated)
    return () => window.removeEventListener(AUTOMATIONS_UPDATED_EVENT, handleAutomationsUpdated)
  }, [loadAutomations])

  function beginAutomationRename(automation: AutomationSummary, event: MouseEvent) {
    event.stopPropagation()
    setPendingDeleteAutomationId(null)
    setEditingAutomationId(automation._id)
    setEditingAutomationName(getAutomationDisplayName(automation))
  }

  function cancelAutomationRename() {
    setEditingAutomationId(null)
    setEditingAutomationName('')
  }

  async function commitAutomationRename(automation: AutomationSummary) {
    const nextName = editingAutomationName.trim()
    const previousName = getAutomationDisplayName(automation)
    if (!nextName || nextName === previousName) {
      cancelAutomationRename()
      return
    }

    setAutomations((prev) => applyAutomationRename(prev, automation._id, nextName))
    cancelAutomationRename()
    try {
      const res = await overlayAppClient.automations.updateResponse({ automationId: automation._id, name: nextName })
      if (!res.ok) throw new Error('Failed to rename automation')
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
    } catch {
      setAutomations((prev) => applyAutomationRename(prev, automation._id, previousName))
    }
  }

  async function performDeleteAutomation(automation: AutomationSummary, event: MouseEvent) {
    event.stopPropagation()
    setPendingDeleteAutomationId(null)
    setDeletingAutomationIds((prev) => prev.includes(automation._id) ? prev : [...prev, automation._id])
    try {
      const res = await overlayAppClient.automations.deleteResponse({ automationId: automation._id })
      if (!res.ok) throw new Error('Failed to delete automation')
      const payload: DeleteAutomationResponse = await overlayAppClient.automations.parseDeleteResponse(res).catch(() => ({}))
      setAutomations((prev) => removeAutomationById(prev, automation._id))
      for (const chatId of payload.linkedConversationIds ?? []) {
        dispatchChatDeleted({ chatId })
      }
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
    } catch {
      // keep row in place
    } finally {
      setDeletingAutomationIds((prev) => prev.filter((id) => id !== automation._id))
    }
  }

  if (loading) return <SidebarListSkeleton rows={3} />

  return (
    <div className="space-y-0.5">
      <AutomationsInlineList
        automations={automations}
        activeId={activeId}
        activeAutomationId={activeAutomationId}
        editingAutomationId={editingAutomationId}
        editingAutomationName={editingAutomationName}
        pendingDeleteAutomationId={pendingDeleteAutomationId}
        deletingAutomationIds={deletingAutomationIds}
        pendingNavId={pendingNavId}
        onNavigateAutomation={(automation, href) => {
          setPendingNavId(automation._id)
          void overlayAppClient.automations.getResponse(
            { automationId: automation._id },
            { credentials: 'same-origin', cache: 'no-store' },
          )
            .catch(() => null)
            .finally(() => {
              setPendingNavId(null)
              router.push(href)
              onNavigate?.()
            })
        }}
        onBeginRename={beginAutomationRename}
        onEditingNameChange={setEditingAutomationName}
        onCommitRename={(automation) => void commitAutomationRename(automation)}
        onCancelRename={cancelAutomationRename}
        onRequestDelete={(automation, event) => {
          event.stopPropagation()
          setPendingDeleteAutomationId(automation._id)
        }}
        onConfirmDelete={(automation, event) => void performDeleteAutomation(automation, event)}
        onClearPendingDelete={() => setPendingDeleteAutomationId(null)}
      />
      {hasMore ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMoreAutomations()}
          className="h-7 w-full rounded-md px-2.5 text-left text-xs text-[var(--muted-light)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}
