'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot, Settings } from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { NEW_AGENT_EVENT, dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import {
  clearAgentOpened,
  getAgentOpenedAt,
  getLastOpenedAgentId,
  rememberAgentOpened,
  sortAgentsByRecency,
} from '@/shared/agents/last-agent-by-workspace'
import { getAgentPanelMode, setAgentPanelMode, type AgentPanelMode } from '@/shared/agents/agent-panel-mode'
import { AgentEditorPage } from './AgentEditorPage'
import { AVATAR_COLORS } from './AgentEditorForm'
import { buildAgentsDirectoryHref, startAgentChat } from '../lib/agent-chat'
import { buildWorkspaceAgentInput } from '../lib/agent-editor-input'
import { DEFAULT_AGENT_TOOL_GROUP_IDS } from '@/shared/agents/tool-groups'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

type EditorMode = 'new' | 'edit' | null

export function AgentConversationWorkspace({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const agentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const conversationId = searchParams?.get('id') ?? null
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [panelMode, setPanelMode] = useState<AgentPanelMode>('docked')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const attemptedAgentRef = useRef<string | null>(null)

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
        const directory = await overlayAppClient.agents.list(activeWorkspaceId)
        if (!directory.canCreate) {
          setEditorMode('new')
          return
        }
        const taken = new Set(directory.agents.map((agent) => agent.name.toLowerCase()))
        let name = 'Untitled agent'
        for (let n = 2; taken.has(name.toLowerCase()) && n < 50; n += 1) name = `Untitled agent ${n}`
        const created = await overlayAppClient.agents.create(activeWorkspaceId, {
          ...buildWorkspaceAgentInput({
            name,
            description: '',
            instructions: 'You are a helpful assistant.',
            agentType: 'overlay',
            harnessLabel: '',
            adapterId: '',
            modelId: DEFAULT_MODEL_ID,
            avatarColor: AVATAR_COLORS[0]!,
            avatarShape: 'circle',
            enabledToolGroups: new Set(DEFAULT_AGENT_TOOL_GROUP_IDS),
            visibility: 'workspace',
          }),
          teamIds: [],
        })
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        rememberAgentOpened(activeWorkspaceId, created.agent.id)
        await startAgentChat({
          workspaceId: activeWorkspaceId,
          agentId: created.agent.id,
          agentPrincipalId: created.agent.principalId,
          surface: 'agents',
          push: (href) => router.push(href),
        })
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

  useEffect(() => {
    setPanelMode(getAgentPanelMode(activeWorkspaceId))
  }, [activeWorkspaceId])

  const togglePanelMode = useCallback(() => {
    setPanelMode((current) => {
      const next: AgentPanelMode = current === 'docked' ? 'floating' : 'docked'
      setAgentPanelMode(activeWorkspaceId, next)
      return next
    })
  }, [activeWorkspaceId])

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
    if (agentId) clearAgentOpened(activeWorkspaceId, agentId)
    router.replace(buildAgentsDirectoryHref(activeWorkspaceId))
  }, [activeWorkspaceId, agentId, router])

  // Owns the no-conversation state: load the roster, then open the most
  // recently used agent directly. The blank page only ever appears when the
  // workspace genuinely has no agents. The sidebar no longer auto-opens, so
  // exactly one DM creation runs per landing.
  const [directoryState, setDirectoryState] = useState<{
    workspaceId: string | null
    agents: WorkspaceAgentDirectoryItem[] | null
    error: string | null
  }>({ workspaceId: null, agents: null, error: null })

  useEffect(() => {
    if (conversationId || !activeWorkspaceId) return
    let cancelled = false
    overlayAppClient.agents.list(activeWorkspaceId).then((response) => {
      if (!cancelled) setDirectoryState({ workspaceId: activeWorkspaceId, agents: response.agents, error: null })
    }).catch(() => {
      if (!cancelled) {
        setDirectoryState({
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

  const directory = directoryState.workspaceId === activeWorkspaceId ? directoryState.agents : null
  const loadError = directoryState.workspaceId === activeWorkspaceId ? directoryState.error : null

  useEffect(() => {
    attemptedAgentRef.current = null
  }, [activeWorkspaceId, conversationId])

  useEffect(() => {
    if (conversationId || !activeWorkspaceId || !directory || directory.length === 0) return
    const lastOpenedId = getLastOpenedAgentId(activeWorkspaceId)
    const target = (agentId ? directory.find((agent) => agent.id === agentId) : undefined)
      ?? (lastOpenedId ? directory.find((agent) => agent.id === lastOpenedId) : undefined)
      ?? sortAgentsByRecency(directory, getAgentOpenedAt(activeWorkspaceId))[0]
    if (!target || attemptedAgentRef.current === target.id) return
    attemptedAgentRef.current = target.id
    rememberAgentOpened(activeWorkspaceId, target.id)
    void (async () => {
      setResolving(true)
      setError(null)
      try {
        await startAgentChat({
          workspaceId: activeWorkspaceId,
          agentId: target.id,
          agentPrincipalId: target.principalId,
          surface: 'agents',
          push: (href) => router.replace(href),
        })
      } catch (chatError) {
        setError(chatError instanceof Error ? chatError.message : 'Could not open the agent conversation.')
      } finally {
        setResolving(false)
      }
    })()
  }, [conversationId, activeWorkspaceId, agentId, directory, retryCount, router])

  const retryOpen = useCallback(() => {
    attemptedAgentRef.current = null
    setError(null)
    setRetryCount((count) => count + 1)
  }, [])

  const editor = editorMode ? (
    <AgentEditorPage
      key={`${editorMode}:${agentId ?? 'new'}`}
      mode={editorMode}
      agentId={editorMode === 'edit' ? (agentId ?? undefined) : undefined}
      presentation="panel"
      panelMode={panelMode}
      onTogglePanelMode={togglePanelMode}
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

  // Logged-out demo: a fixed showcase agent conversation, no backend.
  // Checked before the conversation branch because the showcase URL carries
  // its own demo id, which must not trigger a real fetch.
  if (showcase) {
    return <DirectMessageExperience conversationId="showcase-agent-welcome" showcase />
  }

  if (conversationId) {
    return (
      <DirectMessageExperience
        key={conversationId}
        conversationId={conversationId}
        headerActions={settingsButton}
        externalRightPanel={editor}
        externalRightPanelLabel="Agent settings"
        externalRightPanelMode={panelMode}
        onExternalRightPanelClose={closeEditor}
      />
    )
  }

  const loading = activeWorkspaceId !== null && (directory === null || resolving)
  const displayError = error ?? loadError
  const empty = directory !== null && directory.length === 0 && !displayError

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
  )
}
