'use client'
import { useState, useCallback, useMemo, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { dispatchChatDeleted } from '@/shared/chat/chat-title'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { AutomationSummary } from '@overlay/app-core'
import type { DeleteAutomationResponse } from '@overlay/app-core/automations'
import {
  applyAutomationRename,
  getAutomationDisplayName,
} from '@overlay/app-core/automations'
import { AutomationsInlineList } from '@overlay/modules-react/automations'
import { useLiveAutomations } from '@/hooks/use-live-automations'
import { usePanelListView } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { AgentCreature } from '@/components/orb/Creature'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

export function AutomationsInlinePanel({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const directory = useAgentDirectory()
  const agents = useMemo<WorkspaceAgentDirectoryItem[]>(
    () => directory.workspaceId === activeWorkspaceId ? directory.agents ?? [] : [],
    [activeWorkspaceId, directory.agents, directory.workspaceId],
  )
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null)
  const [editingAutomationName, setEditingAutomationName] = useState('')
  const [pendingDeleteAutomationId, setPendingDeleteAutomationId] = useState<string | null>(null)
  const [deletingAutomationIds, setDeletingAutomationIds] = useState<string[]>([])
  const activeId = searchParams?.get('id') ?? null
  const activeAutomationId = searchParams?.get('automationId') ?? null
  const listView = usePanelListView()
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  // Live: definitions, schedules and enabled state from any tab or agent appear without a reload.
  const live = useLiveAutomations(listView)
  // A rename shows at once and stays until the live list carries it (or the server refuses it).
  const [renames, setRenames] = useState<ReadonlyMap<string, string>>(() => new Map())
  const automations = useMemo<AutomationSummary[]>(() => {
    let rows = (live ?? []) as AutomationSummary[]
    for (const [id, name] of renames) rows = applyAutomationRename(rows, id, name)
    return rows
  }, [live, renames])
  const loading = live === undefined
  const forgetRename = useCallback((id: string) => setRenames((current) => {
    if (!current.has(id)) return current
    const next = new Map(current)
    next.delete(id)
    return next
  }), [])

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

    setRenames((current) => new Map(current).set(automation._id, nextName))
    cancelAutomationRename()
    try {
      const res = await overlayAppClient.automations.updateResponse({ automationId: automation._id, name: nextName })
      if (!res.ok) throw new Error('Failed to rename automation')
    } finally {
      forgetRename(automation._id)
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
      for (const chatId of payload.linkedConversationIds ?? []) {
        dispatchChatDeleted({ chatId })
      }
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
        pendingNavId={null}
        onNavigateAutomation={(_automation, href) => {
          router.push(href)
          onNavigate?.()
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
        renderRowActions={(automation) => (
          <ScopeItemActions
            kind="content"
            resource="automations"
            item={automation}
          />
        )}
        renderLeadingIcon={(automation) => {
          const agent = automation.agentId ? agentsById.get(automation.agentId) : undefined
          return agent ? <AgentCreature isDefault={agent.isDefault} agent={agent} size={16} /> : null
        }}
      />
    </div>
  )
}
