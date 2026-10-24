'use client'

import { unstyledButton } from '@overlay/ui/control-reset'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Bot, Settings } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { ChatSurfaceEmptyState } from '@/features/chat/components/ChatSurfaceEmptyState'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { RightSidebarToggle } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  agentBelongsToCreatorScope,
  agentsForCreatorScope,
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
import { AgentRightSidebar } from './AgentRightSidebar'
import { AgentComputerControlOverlay } from './AgentComputerTab.parts'
import { sendAgentGreeting, startAgentChat } from '../lib/agent-chat'
import { NewAgentDialog } from './NewAgentDialog'
import { usePanelScope } from '@/hooks/use-panel-scope'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { AgentDirectoryScreen, AgentEditorPanel } from './AgentConversationWorkspace.parts'

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
  buildHref: ReturnType<typeof useWorkspaceHref>
  agentId: string | null
  router: { push(href: string): void; replace(href: string): void }
  onEditorModeChange(mode: EditorMode): void
  onError(message: string | null): void
  onRetry(): void
}) {
  const { activeWorkspaceId, buildHref, agentId, router, onEditorModeChange, onError, onRetry } = args

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
            scope: 'personal',
            buildHref,
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
    [activeWorkspaceId, buildHref, router, onEditorModeChange, onError],
  )

  const handleArchived = useCallback(() => {
    onEditorModeChange(null)
    if (agentId) clearAgentOpened(activeWorkspaceId, agentId)
    router.replace(buildHref(activeWorkspaceId, '/app/agents', 'personal'))
  }, [activeWorkspaceId, buildHref, agentId, router, onEditorModeChange])

  const retryOpen = useCallback(() => {
    onError(null)
    onRetry()
  }, [onError, onRetry])

  return { openCreatedAgent, handleArchived, retryOpen }
}

type AgentDirectoryState = {
  workspaceId: string | null
  agents: WorkspaceAgentDirectoryItem[] | null
  viewerPrincipalId: string | null
  error: string | null
}

/** Loads the roster once per landing. Own budget, kept out of the component. */
function useAgentDirectory(
  activeWorkspaceId: string | null,
): { directory: WorkspaceAgentDirectoryItem[] | null; viewerPrincipalId: string | null; loadError: string | null } {
  const [state, setState] = useState<AgentDirectoryState>({
    workspaceId: null,
    agents: null,
    viewerPrincipalId: null,
    error: null,
  })
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    overlayAppClient.agents.list(activeWorkspaceId).then((response) => {
      if (!cancelled) setState({
        workspaceId: activeWorkspaceId,
        agents: response.agents,
        viewerPrincipalId: response.viewerPrincipalId ?? null,
        error: null,
      })
    }).catch(() => {
      if (!cancelled) {
        setState({
          workspaceId: activeWorkspaceId,
          agents: [],
          viewerPrincipalId: null,
          error: 'Could not load your agents. Check your connection and retry.',
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])
  if (state.workspaceId !== activeWorkspaceId) {
    return { directory: null, viewerPrincipalId: null, loadError: null }
  }
  return { directory: state.agents, viewerPrincipalId: state.viewerPrincipalId, loadError: state.error }
}

/** Opens the picked agent's conversation. Own budget, kept out of the component. */
function useAgentAutoOpen(args: {
  conversationId: string | null
  activeWorkspaceId: string | null
  agentId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  viewerPrincipalId: string | null
  scope: PanelScope
  buildHref: ReturnType<typeof useWorkspaceHref>
  retryCount: number
  router: { replace(href: string): void }
  onResolvingChange(next: boolean): void
  onError(message: string | null): void
}) {
  const {
    conversationId, activeWorkspaceId, agentId, directory, viewerPrincipalId, scope, buildHref, retryCount, router,
    onResolvingChange, onError,
  } = args
  const attemptedAgentRef = useRef<string | null>(null)

  useEffect(() => {
    attemptedAgentRef.current = null
  }, [activeWorkspaceId, conversationId])

  useEffect(() => {
    if (conversationId || !activeWorkspaceId || !directory || directory.length === 0) return
    const scopedDirectory = agentsForCreatorScope(directory, viewerPrincipalId, scope)
    if (agentId && !scopedDirectory.some((agent) => agent.id === agentId)) return
    const target = pickAgentToOpen(scopedDirectory, activeWorkspaceId, agentId)
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
          scope,
          buildHref,
          push: (href) => router.replace(href),
        })
      } catch (chatError) {
        onError(chatError instanceof Error ? chatError.message : 'Could not open the agent conversation.')
      } finally {
        onResolvingChange(false)
      }
    })()
  }, [conversationId, activeWorkspaceId, agentId, directory, viewerPrincipalId, scope, buildHref, retryCount, router, onResolvingChange, onError])
}

function requestedAgentScope(
  agent: WorkspaceAgentDirectoryItem | null,
  viewerPrincipalId: string | null,
): PanelScope | null {
  if (!agent || !viewerPrincipalId) return null
  return agentBelongsToCreatorScope(agent, viewerPrincipalId, 'personal') ? 'personal' : 'workspace'
}

function useRequestedAgentScopeRedirect(args: {
  agentId: string | null
  requestedAgent: WorkspaceAgentDirectoryItem | null
  scope: PanelScope
  requestedScope: PanelScope | null
  pathname: string
  search: string
  buildHref: ReturnType<typeof useWorkspaceHref>
  router: ReturnType<typeof useRouter>
}) {
  const { agentId, requestedAgent, scope, requestedScope, pathname, search, buildHref, router } = args
  useEffect(() => {
    if (!agentId || !requestedAgent || !requestedScope || requestedAgent.archivedAt || requestedScope === scope) return
    const current = `${pathname}${search ? `?${search}` : ''}${window.location.hash}`
    router.replace(buildHref(null, current, requestedScope))
  }, [agentId, buildHref, pathname, requestedAgent, requestedScope, router, scope, search])
}

function agentDetailRouteState(args: {
  conversationId: string | null
  agentId: string | null
  activeWorkspaceId: string | null
  loadError: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  requestedAgent: WorkspaceAgentDirectoryItem | null
  viewerPrincipalId: string | null
  requestedScope: PanelScope | null
  scope: PanelScope
}): 'none' | 'unavailable' | 'pending' | 'ready' {
  if (!args.conversationId || !args.agentId) return 'none'
  if (!args.activeWorkspaceId || args.loadError) return 'unavailable'
  if (!args.directory) return 'pending'
  if (!args.requestedAgent || !args.viewerPrincipalId || args.requestedAgent.archivedAt) return 'unavailable'
  if (args.requestedScope !== args.scope) return 'pending'
  return 'ready'
}

export function AgentConversationWorkspace({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const buildWorkspaceHref = useWorkspaceHref()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
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
    buildHref: buildWorkspaceHref,
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
  const { directory, viewerPrincipalId, loadError } = useAgentDirectory(activeWorkspaceId)
  const scope = usePanelScope()
  const requestedAgent = directory?.find((agent) => agent.id === agentId) ?? null
  const requestedScope = requestedAgentScope(requestedAgent, viewerPrincipalId)

  useAgentAutoOpen({
    conversationId,
    activeWorkspaceId,
    agentId,
    directory,
    viewerPrincipalId,
    scope,
    buildHref: buildWorkspaceHref,
    retryCount,
    router,
    onResolvingChange: setResolving,
    onError: setError,
  })

  useRequestedAgentScopeRedirect({
    agentId,
    requestedAgent,
    scope,
    requestedScope,
    pathname,
    search: searchParams?.toString() ?? '',
    buildHref: buildWorkspaceHref,
    router,
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

  const detailState = agentDetailRouteState({
    conversationId,
    agentId,
    activeWorkspaceId,
    loadError,
    directory,
    requestedAgent,
    viewerPrincipalId,
    requestedScope,
    scope,
  })
  if (detailState === 'unavailable') {
    return (
      <ChatSurfaceEmptyState
        icon={Bot}
        title="Agent unavailable"
        description="This agent could not be opened."
      />
    )
  }
  if (detailState === 'pending') return null

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
        directory={directory}
        viewerPrincipalId={viewerPrincipalId}
        scope={scope}
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
