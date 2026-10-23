'use client'

import { unstyledButton } from '@overlay/ui/control-reset'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot, Settings } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { agentsInScope } from '@/shared/agents/agent-scope'
import { resolvePanelScopeFromParams, type PanelScope } from '@/shared/workspaces/panel-scope'
import { RightSidebarToggle } from '@overlay/modules-react/shell'
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
import {
  getAgentRightSidebarPreferences,
  setAgentRightSidebarPreferences,
  type AgentRightSidebarPreferences,
} from '@/shared/agents/agent-right-sidebar-preferences'
import { NEW_AGENT_EVENT } from '@/shared/workspace/sidebar-events'
import { AgentEditorPage } from './AgentEditorPage'
import { AgentRightSidebar } from './AgentRightSidebar'
import { AgentComputerControlOverlay } from './AgentComputerTab.parts'
import { buildAgentsDirectoryHref, sendAgentGreeting, startAgentChat } from '../lib/agent-chat'
import { NewAgentDialog } from './NewAgentDialog'

type EditorMode = 'new' | 'edit' | null

function AgentSettingsButton({ hasAgent, active, onClick }: {
  hasAgent: boolean
  active: boolean
  onClick(): void
}) {
  return (
    <Button variant="ghost"
      type="button"
      aria-label={hasAgent ? 'Agent settings' : 'Create agent'}
      title={hasAgent ? 'Agent settings' : 'Create agent'}
      onClick={onClick}
      className={unstyledButton(`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) ${
        active ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'
      }`)}
    >
      <Settings size={15} />
    </Button>
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
  viewerPrincipalId?: string | null
  error: string | null
}

/** Loads the roster once per landing. Own budget, kept out of the component. */
function useAgentDirectory(
  activeWorkspaceId: string | null,
  scope: PanelScope,
  solo: boolean,
): { directory: WorkspaceAgentDirectoryItem[] | null; loadError: string | null } {
  const [state, setState] = useState<AgentDirectoryState>({ workspaceId: null, agents: null, error: null })
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    overlayAppClient.agents.list(activeWorkspaceId).then((response) => {
      if (!cancelled) setState({ workspaceId: activeWorkspaceId, agents: response.agents, viewerPrincipalId: response.viewerPrincipalId ?? null, error: null })
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
  }, [activeWorkspaceId])
  const directory = useMemo(() => state.workspaceId === activeWorkspaceId && state.agents
    ? agentsInScope(state.agents, state.viewerPrincipalId ?? null, scope, solo) : null,
  [state, activeWorkspaceId, scope, solo])
  return { directory, loadError: state.workspaceId === activeWorkspaceId ? state.error : null }
}

/** Opens the picked agent's conversation. Own budget, kept out of the component. */
function useAgentAutoOpen(args: {
  conversationId: string | null
  activeWorkspaceId: string | null
  agentId: string | null
  scope: PanelScope
  directory: WorkspaceAgentDirectoryItem[] | null
  retryCount: number
  router: { replace(href: string): void }
  onResolvingChange(next: boolean): void
  onError(message: string | null): void
}) {
  const {
    conversationId, activeWorkspaceId, agentId, scope, directory, retryCount, router,
    onResolvingChange, onError,
  } = args
  const attemptedAgentRef = useRef<string | null>(null)

  useEffect(() => {
    attemptedAgentRef.current = null
  }, [activeWorkspaceId, conversationId, scope, retryCount])

  useEffect(() => {
    if (conversationId || !activeWorkspaceId || !directory || directory.length === 0) return
    const target = agentId ? directory.find((agent) => agent.id === agentId) : pickAgentToOpen(directory, activeWorkspaceId)
    if (!target || attemptedAgentRef.current === target.id) return
    attemptedAgentRef.current = target.id
    rememberAgentOpened(activeWorkspaceId, target.id)
    onResolvingChange(true)
    onError(null)
    let cancelled = false
    void (async () => {
      try {
        await startAgentChat({
          workspaceId: activeWorkspaceId,
          agentId: target.id,
          agentPrincipalId: target.principalId,
          surface: 'agents',
          scope,
          push: (href) => { if (!cancelled) router.replace(href) },
        })
      } catch (chatError) {
        if (!cancelled) onError(chatError instanceof Error ? chatError.message : 'Could not open the agent conversation.')
      } finally {
        if (!cancelled) onResolvingChange(false)
      }
    })()
    return () => { cancelled = true; attemptedAgentRef.current = null }
  }, [conversationId, activeWorkspaceId, agentId, scope, directory, retryCount, router, onResolvingChange, onError])
}

export function AgentConversationWorkspace({ showcase = false }: { showcase?: boolean }) {
  const searchParams = useSearchParams()
  const savedScope = usePanelScope()
  const solo = useIsSoloWorkspace()
  const scope = resolvePanelScopeFromParams(searchParams, savedScope, solo)
  return <AgentConversationWorkspaceContent key={scope} scope={scope} showcase={showcase} />
}

function AgentConversationWorkspaceContent({ scope, showcase }: { scope: PanelScope; showcase: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const solo = useIsSoloWorkspace()
  const agentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const conversationId = searchParams?.get('id') ?? null
  const [sidebarPreferences, setSidebarPreferences] = useState<AgentRightSidebarPreferences>(
    () => getAgentRightSidebarPreferences(),
  )
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [panelMode, setPanelModeState] = useState<'dialog' | 'side'>(() => getAgentEditorPanelMode())
  const setPanelMode = useCallback((next: 'dialog' | 'side') => {
    setAgentEditorPanelMode(next)
    setPanelModeState(next)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [computerControlState, setComputerControlState] = useState<{
    conversationId: string | null
    control: { ticketUrl: string; computerName: string; refreshTicket: () => void } | null
  }>({ conversationId: null, control: null })
  const computerControl = computerControlState.conversationId === conversationId
    ? computerControlState.control
    : null
  const updateComputerControl = useCallback((control: {
    ticketUrl: string
    computerName: string
    refreshTicket: () => void
  } | null) => {
    setComputerControlState({ conversationId, control })
  }, [conversationId])

  const [createOpen, setCreateOpen] = useState(false)
  useEffect(() => {
    setAgentRightSidebarPreferences(sidebarPreferences)
  }, [sidebarPreferences])

  const closeRightSidebar = useCallback(() => {
    setSidebarPreferences((current) => ({ ...current, open: false }))
  }, [])

  const updateSidebarOpen = useCallback((open: boolean) => {
    setSidebarPreferences((current) => ({ ...current, open }))
  }, [])

  const updateSidebarTab = useCallback((id: string) => {
    if (id !== 'details' && id !== 'library' && id !== 'computer') return
    setSidebarPreferences((current) => ({ ...current, tab: id }))
  }, [])

  // "New agent" opens the creation dialog; nothing is created until the
  // person confirms. The logged-out showcase keeps the static editor form.
  const openCreate = useCallback(() => {
    setError(null)
    if (showcase) {
      setEditorMode('new')
      return
    }
    setEditorMode(null)
    setCreateOpen(true)
  }, [showcase])

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
  const { directory, loadError } = useAgentDirectory(activeWorkspaceId, scope, solo)

  useAgentAutoOpen({
    conversationId,
    activeWorkspaceId,
    agentId,
    scope,
    directory,
    retryCount,
    router,
    onResolvingChange: setResolving,
    onError: setError,
  })

  const editor = editorMode ? (
    <AgentEditorPanel
      key={`${editorMode}:${agentId ?? 'new'}`}
      mode={editorMode}
      agentId={agentId}
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
  const createDialog = showcase ? null : (
    <NewAgentDialog
      open={createOpen}
      workspaceId={activeWorkspaceId}
      onClose={() => setCreateOpen(false)}
      onOpenMachineSetup={() => { setCreateOpen(false); setEditorMode('new') }}
      onCreated={(agent, warning) => {
        setCreateOpen(false)
        openCreatedAgent(agent)
        if (warning) setError(warning)
      }}
    />
  )

  const settingsButton = (
    <AgentSettingsButton
      hasAgent={false}
      active={Boolean(editorMode)}
      onClick={openCreate}
    />
  )

  // Logged-out demo: a fixed showcase agent conversation, no backend.
  // Checked before the conversation branch because the showcase URL carries
  // its own demo id, which must not trigger a real fetch.
  if (showcase) {
    return <DirectMessageExperience conversationId="showcase-agent-welcome" showcase />
  }

  if (conversationId) {
    const agentSidebar = agentId && sidebarPreferences.open ? (
      <AgentRightSidebar
        agentId={agentId}
        activeWorkspaceId={activeWorkspaceId}
        conversationId={conversationId}
        activeTab={sidebarPreferences.tab}
        onTabChange={updateSidebarTab}
        onClose={closeRightSidebar}
        onArchived={handleArchived}
        showcase={showcase}
        controlled={Boolean(computerControl)}
        onTakeControl={(ticketUrl, computerName, refreshTicket) => {
          updateComputerControl({ ticketUrl, computerName, refreshTicket })
        }}
      />
    ) : null
    return (
      <>
        <DirectMessageExperience
          key={conversationId}
          conversationId={conversationId}
          headerActions={agentId ? (
            <RightSidebarToggle
              open={sidebarPreferences.open}
              onToggle={() => updateSidebarOpen(!sidebarPreferences.open)}
            />
          ) : undefined}
          externalRightPanel={agentSidebar}
          externalRightPanelLabel="Agent sidebar"
          externalRightPanelMode="docked"
          externalRightPanelWidth={380}
          onExternalRightPanelClose={closeRightSidebar}
          bodyOverlay={computerControl ? (
            <AgentComputerControlOverlay
              ticketUrl={computerControl.ticketUrl}
              computerName={computerControl.computerName}
              onClose={() => {
                if (sidebarPreferences.open) computerControl.refreshTicket()
                updateComputerControl(null)
              }}
            />
          ) : null}
        />
        {dialogEditor}
        {createDialog}
      </>
    )
  }

  return (
    <>
      <AgentDirectoryScreen
        settingsButton={settingsButton}
        sideEditor={sideEditor}
        onRightPanelClose={closeEditor}
        activeWorkspaceId={activeWorkspaceId}
        agentId={agentId}
        directory={directory}
        resolving={resolving}
        error={error}
        loadError={loadError}
        onRetry={retryOpen}
        onCreate={openCreate}
      />
      {dialogEditor}
      {createDialog}
    </>
  )
}

function AgentEditorPanel({
  mode,
  agentId,
  panelMode,
  onTogglePanelMode,
  onClose,
  onCreated,
  onArchived,
}: {
  mode: 'new' | 'edit'
  agentId: string | null
  panelMode: 'dialog' | 'side'
  onTogglePanelMode(): void
  onClose(): void
  onCreated(agent: WorkspaceAgentDirectoryItem): void
  onArchived(): void
}) {
  return (
    <AgentEditorPage
      mode={mode}
      agentId={mode === 'edit' ? (agentId ?? undefined) : undefined}
      presentation="panel"
      panelMode={panelMode}
      onTogglePanelMode={onTogglePanelMode}
      onClose={onClose}
      onCreated={onCreated}
      onArchived={onArchived}
    />
  )
}

function AgentDirectoryScreen({
  settingsButton,
  sideEditor,
  onRightPanelClose,
  activeWorkspaceId,
  agentId,
  directory,
  resolving,
  error,
  loadError,
  onRetry,
  onCreate,
}: {
  settingsButton: ReactNode
  sideEditor: ReactNode
  onRightPanelClose(): void
  activeWorkspaceId: string | null
  agentId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  resolving: boolean
  error: string | null
  loadError: string | null
  onRetry(): void
  onCreate(): void
}) {
  // Loading covers three phases with no gaps: roster fetch, the frame between
  // roster arrival and the resolve effect firing, and the DM creation itself.
  // The empty state therefore only ever renders for genuinely agent-less
  // workspaces — never as a flash while a conversation is about to open.
  const displayError = error ?? loadError ?? (agentId && directory && !directory.some((agent) => agent.id === agentId)
    ? 'This agent is not available in this scope.' : null)
  const resolvingConversation = directory !== null && directory.length > 0 && !displayError
  const loading = activeWorkspaceId !== null && (directory === null || resolving || resolvingConversation)
  const empty = directory !== null && directory.length === 0 && !displayError

  return (
    <AppScreenShell
      header={<AppScreenHeader title="Agents" actions={settingsButton} />}
      rightPanel={sideEditor}
      rightPanelMode="docked"
      rightPanelWidth="lg"
      onRightPanelClose={onRightPanelClose}
    >
      <AppScreenBody className="flex min-h-full items-center justify-center p-6" padding="none">
      {loading ? (
        <div className="flex items-center gap-1.5" role="status" aria-label="Opening your agent">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--muted)"
              style={{ animationDelay: `${dot * 150}ms` }}
            />
          ))}
        </div>
      ) : (
        <div className="max-w-sm text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-subtle) text-(--muted)">
            <Bot size={18} />
          </span>
          <h1 className="mt-4 text-sm font-medium text-(--foreground)">
            {displayError ? 'Could not open your agent' : 'Your agents work from here'}
          </h1>
          <p className="mt-1.5 text-xs leading-5 text-(--muted)">
            {displayError ?? (empty
              ? 'Create one for a new outcome.'
              : 'Select an agent to open its conversation, or create one for a new outcome.')}
          </p>
          {displayError ? (
            <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
              Retry
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="mt-4" onClick={onCreate}>
              Create agent
            </Button>
          )}
        </div>
      )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
