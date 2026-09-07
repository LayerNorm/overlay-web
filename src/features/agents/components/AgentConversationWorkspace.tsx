'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot, Settings } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { NEW_AGENT_EVENT } from '@/shared/workspace/sidebar-events'
import { AgentEditorPage } from './AgentEditorPage'
import { buildAgentsDirectoryHref, startAgentChat } from '../lib/agent-chat'

type EditorMode = 'new' | 'edit' | null

export function AgentConversationWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const agentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const conversationId = searchParams?.get('id') ?? null
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [error, setError] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setError(null)
    setEditorMode('new')
  }, [])

  useEffect(() => {
    window.addEventListener(NEW_AGENT_EVENT, openCreate)
    return () => window.removeEventListener(NEW_AGENT_EVENT, openCreate)
  }, [openCreate])

  const closeEditor = useCallback(() => setEditorMode(null), [])

  const openCreatedAgent = useCallback(
    (agent: WorkspaceAgentDirectoryItem) => {
      setEditorMode(null)
      setError(null)
      void startAgentChat({
        workspaceId: activeWorkspaceId,
        agentId: agent.id,
        agentPrincipalId: agent.principalId,
        surface: 'agents',
        push: (href) => router.push(href),
      }).catch((chatError) => {
        setError(chatError instanceof Error ? chatError.message : 'Could not open the new agent.')
      })
    },
    [activeWorkspaceId, router],
  )

  const handleArchived = useCallback(() => {
    setEditorMode(null)
    router.replace(buildAgentsDirectoryHref(activeWorkspaceId))
  }, [activeWorkspaceId, router])

  const editor = editorMode ? (
    <AgentEditorPage
      key={`${editorMode}:${agentId ?? 'new'}`}
      mode={editorMode}
      agentId={editorMode === 'edit' ? (agentId ?? undefined) : undefined}
      presentation="panel"
      onClose={closeEditor}
      onCreated={openCreatedAgent}
      onArchived={handleArchived}
    />
  ) : null

  const settingsButton = (
    <button
      type="button"
      aria-label={agentId ? 'Agent settings' : 'Create agent'}
      title={agentId ? 'Agent settings' : 'Create agent'}
      onClick={() => setEditorMode(agentId ? 'edit' : 'new')}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
        editorMode ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)]'
      }`}
    >
      <Settings size={15} />
    </button>
  )

  if (conversationId) {
    return (
      <DirectMessageExperience
        key={conversationId}
        conversationId={conversationId}
        headerActions={settingsButton}
        externalRightPanel={editor}
        externalRightPanelLabel="Agent settings"
        onExternalRightPanelClose={closeEditor}
      />
    )
  }

  return (
    <AppScreenShell
      header={<AppScreenHeader title="Agents" actions={settingsButton} />}
      rightPanel={editor}
      rightPanelOpen={Boolean(editor)}
      rightPanelWidth="lg"
      rightPanelOverlayLabel="Agent settings"
      onRightPanelClose={closeEditor}
    >
      <AppScreenBody className="flex min-h-full items-center justify-center p-6" padding="none">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)]">
            <Bot size={18} />
          </span>
          <h1 className="mt-4 text-sm font-medium text-[var(--foreground)]">Your agents work from here</h1>
          <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
            Select an agent to open its conversation, or create one for a new outcome.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-xs text-red-500">
              {error}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" className="mt-4" onClick={openCreate}>
            Create agent
          </Button>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
