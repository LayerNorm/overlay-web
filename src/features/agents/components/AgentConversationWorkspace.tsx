'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot, Settings } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  clearAgentOpened,
  pickAgentToOpen,
  rememberAgentOpened,
} from '@/shared/agents/last-agent-by-workspace'
import {
  getAgentEditorPanelMode,
  setAgentEditorPanelMode,
} from '@/shared/agents/agent-editor-presentation'
import { NEW_AGENT_EVENT, dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { AgentEditorPage } from './AgentEditorPage'
import { buildAgentsDirectoryHref, createAgentAndOpenChat, sendAgentGreeting, startAgentChat } from '../lib/agent-chat'

type EditorMode = 'new' | 'edit' | null

function AgentSettingsButton({ hasAgent, active, onClick }: {
  hasAgent: boolean
  active: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      aria-label={hasAgent ? 'Agent settings' : 'Create agent'}
      title={hasAgent ? 'Agent settings' : 'Create agent'}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
        active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)]'
      }`}
    >
      <Settings size={15} />
    </button>
  )
}

/** Post-create/archive/retry navigation. Own budget, kept out of the component. */
function useAgentWorkspaceActions(args: {
  activeWorkspaceId: string | null
  agentId: string | null
  router: { push(href: string): void; replace(href: string): void }
  onEditorModeChange(mode: EditorMode): void
  onError(message: string | null): void
  onRetry(): void
}) {
  const { activeWorkspaceId, agentId, router, onEditorModeChange, onError, onRetry } = args

  const openCreatedAgent = useCallback(
    (agent: WorkspaceAgentDirectoryItem) => {
      onEditorModeChange(null)
      onError(null)
      void (async () => {
        try {
          const conversationId = await startAgentChat({
            workspaceId: activeWorkspaceId,
            agentId: agent.id,
            agentPrincipalId: agent.principalId,
            surface: 'agents',
            push: (href) => router.push(href),
          })
          if (conversationId && activeWorkspaceId) {
            await sendAgentGreeting({ workspaceId: activeWorkspaceId, conversationId, agentId: agent.id })
          }
        } catch (chatError) {
          onError(chatError instanceof Error ? chatError.message : 'Could not open the new agent.')
        }
      })()
    },
    [activeWorkspaceId, router, onEditorModeChange, onError],
  )

  const handleArchived = useCallback(() => {
    onEditorModeChange(null)
    if (agentId) clearAgentOpened(activeWorkspaceId, agentId)
    router.replace(buildAgentsDirectoryHref(activeWorkspaceId))
  }, [activeWorkspaceId, agentId, router, onEditorModeChange])

  const retryOpen = useCallback(() => {
    onError(null)
    onRetry()
  }, [onError, onRetry])

  return { openCreatedAgent, handleArchived, retryOpen }
}

type AgentDirectoryState = {
  workspaceId: string | null
  agents: WorkspaceAgentDirectoryItem[] | null
  error: string | null
}

/** Loads the roster once per landing. Own budget, kept out of the component. */
function useAgentDirectory(
  activeWorkspaceId: string | null,
  conversationId: string | null,
): { directory: WorkspaceAgentDirectoryItem[] | null; loadError: string | null } {
  const [state, setState] = useState<AgentDirectoryState>({ workspaceId: null, agents: null, error: null })
  useEffect(() => {
    if (conversationId || !activeWorkspaceId) return
    let cancelled = false
    overlayAppClient.agents.list(activeWorkspaceId).then((response) => {
      if (!cancelled) setState({ workspaceId: activeWorkspaceId, agents: response.agents, error: null })
    }).catch(() => {
      if (!cancelled) {
        setState({
          workspaceId: activeWorkspaceId,
          agents: [],
          error: 'Could not load your agents. Check your connection and retry.',
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, activeWorkspaceId])
  if (state.workspaceId !== activeWorkspaceId) return { directory: null, loadError: null }
  return { directory: state.agents, loadError: state.error }
}

/** Opens the picked agent's conversation. Own budget, kept out of the component. */
function useAgentAutoOpen(args: {
  conversationId: string | null
  activeWorkspaceId: string | null
  agentId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  retryCount: number
  router: { replace(href: string): void }
  onResolvingChange(next: boolean): void
  onError(message: string | null): void
}) {
  const {
    conversationId, activeWorkspaceId, agentId, directory, retryCount, router,
    onResolvingChange, onError,
  } = args
  const attemptedAgentRef = useRef<string | null>(null)

  useEffect(() => {
    attemptedAgentRef.current = null
  }, [activeWorkspaceId, conversationId])

  useEffect(() => {
    if (conversationId || !activeWorkspaceId || !directory || directory.length === 0) return
    const target = pickAgentToOpen(directory, activeWorkspaceId, agentId)
    if (!target || attemptedAgentRef.current === target.id) return
    attemptedAgentRef.current = target.id
    rememberAgentOpened(activeWorkspaceId, target.id)
    onResolvingChange(true)
    onError(null)
    void (async () => {
      try {
        await startAgentChat({
          workspaceId: activeWorkspaceId,
          agentId: target.id,
          agentPrincipalId: target.principalId,
          surface: 'agents',
          push: (href) => router.replace(href),
        })
      } catch (chatError) {
        onError(chatError instanceof Error ? chatError.message : 'Could not open the agent conversation.')
      } finally {
        onResolvingChange(false)
      }
    })()
  }, [conversationId, activeWorkspaceId, agentId, directory, retryCount, router, onResolvingChange, onError])
}

export function AgentConversationWorkspace({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const agentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const conversationId = searchParams?.get('id') ?? null
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [panelMode, setPanelModeState] = useState<'dialog' | 'side'>(() => getAgentEditorPanelMode())
  const setPanelMode = useCallback((next: 'dialog' | 'side') => {
    setAgentEditorPanelMode(next)
    setPanelModeState(next)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const creatingAgentRef = useRef(false)

  // Create-first: "New agent" immediately creates a real agent with defaults,
  // refreshes the sidebar, opens its conversation, then opens the edit panel
  // pointed at it. The panel never creates in the context of another agent.
  const openCreate = useCallback(() => {
    if (showcase) {
      setError(null)
      setEditorMode('new')
      return
    }
    if (!activeWorkspaceId || creatingAgentRef.current) return
    creatingAgentRef.current = true
    setError(null)
    setEditorMode(null)
    void (async () => {
      try {
        const result = await createAgentAndOpenChat({
          workspaceId: activeWorkspaceId,
          push: (href) => router.push(href),
          onDirectoryChanged: dispatchAgentDirectoryChanged,
          onOpened: (agentId) => rememberAgentOpened(activeWorkspaceId, agentId),
        })
        if (result.status === 'no-permission') {
          setEditorMode('new')
          return
        }
        setEditorMode('edit')
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Could not create the agent.')
      } finally {
        creatingAgentRef.current = false
      }
    })()
  }, [showcase, activeWorkspaceId, router])

  useEffect(() => {
    window.addEventListener(NEW_AGENT_EVENT, openCreate)
    return () => window.removeEventListener(NEW_AGENT_EVENT, openCreate)
  }, [openCreate])

  const closeEditor = useCallback(() => setEditorMode(null), [])

  const workspaceActions = useAgentWorkspaceActions({
    activeWorkspaceId,
    agentId,
    router,
    onEditorModeChange: setEditorMode,
    onError: setError,
    onRetry: () => setRetryCount((count) => count + 1),
  })
  const { openCreatedAgent, handleArchived, retryOpen } = workspaceActions

  // Owns the no-conversation state: load the roster, then open the picked
  // agent directly. The blank page only ever appears when the workspace
  // genuinely has no agents. The sidebar no longer auto-opens, so exactly
  // one DM creation runs per landing.
  const { directory, loadError } = useAgentDirectory(activeWorkspaceId, conversationId)

  useAgentAutoOpen({
    conversationId,
    activeWorkspaceId,
    agentId,
    directory,
    retryCount,
    router,
    onResolvingChange: setResolving,
    onError: setError,
  })

  const editor = editorMode ? (
    <AgentEditorPage
      key={`${editorMode}:${agentId ?? 'new'}`}
      mode={editorMode}
      agentId={editorMode === 'edit' ? (agentId ?? undefined) : undefined}
      presentation="panel"
      panelMode={panelMode}
      onTogglePanelMode={() => setPanelMode(panelMode === 'dialog' ? 'side' : 'dialog')}
      onClose={closeEditor}
      onCreated={openCreatedAgent}
      onArchived={handleArchived}
    />
  ) : null
  // Side mode docks through the screen's rightPanel slot; rendering the panel
  // as a plain sibling stacks it under the content instead of beside it.
  const sideEditor = panelMode === 'side' ? editor : null
  const dialogEditor = panelMode === 'dialog' ? editor : null

  const settingsButton = (
    <AgentSettingsButton
      hasAgent={Boolean(agentId)}
      active={Boolean(editorMode)}
      onClick={() => setEditorMode(agentId ? 'edit' : 'new')}
    />
  )

  // Logged-out demo: a fixed showcase agent conversation, no backend.
  // Checked before the conversation branch because the showcase URL carries
  // its own demo id, which must not trigger a real fetch.
  if (showcase) {
    return <DirectMessageExperience conversationId="showcase-agent-welcome" showcase />
  }

  if (conversationId) {
    return (
      <>
        <DirectMessageExperience
          key={conversationId}
          conversationId={conversationId}
          headerActions={settingsButton}
          externalRightPanel={sideEditor}
          externalRightPanelLabel="Agent settings"
          externalRightPanelMode="docked"
          onExternalRightPanelClose={closeEditor}
        />
        {dialogEditor}
      </>
    )
  }

  // Loading covers three phases with no gaps: roster fetch, the frame between
  // roster arrival and the resolve effect firing, and the DM creation itself.
  // The empty state therefore only ever renders for genuinely agent-less
  // workspaces — never as a flash while a conversation is about to open.
  const displayError = error ?? loadError
  const resolvingConversation = directory !== null && directory.length > 0 && !displayError
  const loading = activeWorkspaceId !== null && (directory === null || resolving || resolvingConversation)
  const empty = directory !== null && directory.length === 0 && !displayError

  return (
    <>
      <AppScreenShell
        header={<AppScreenHeader title="Agents" actions={settingsButton} />}
        rightPanel={sideEditor}
        rightPanelMode="docked"
        rightPanelWidth="lg"
        onRightPanelClose={closeEditor}
      >
        <AppScreenBody className="flex min-h-full items-center justify-center p-6" padding="none">
        {loading ? (
          <div className="flex items-center gap-1.5" role="status" aria-label="Opening your agent">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]"
                style={{ animationDelay: `${dot * 150}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="max-w-sm text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)]">
              <Bot size={18} />
            </span>
            <h1 className="mt-4 text-sm font-medium text-[var(--foreground)]">
              {displayError ? 'Could not open your agent' : 'Your agents work from here'}
            </h1>
            <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
              {displayError ?? (empty
                ? 'Create one for a new outcome.'
                : 'Select an agent to open its conversation, or create one for a new outcome.')}
            </p>
            {displayError ? (
              <Button variant="secondary" size="sm" className="mt-4" onClick={retryOpen}>
                Retry
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="mt-4" onClick={openCreate}>
                Create agent
              </Button>
            )}
          </div>
        )}
      </AppScreenBody>
      </AppScreenShell>
      {dialogEditor}
    </>
  )
}
