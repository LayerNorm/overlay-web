'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, MessageSquare, MoreHorizontal, Plus, Share2 } from 'lucide-react'
import type { AgentBinding, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button, CreateTile, Tile, TileGrid, TileSkeleton } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShareDialog } from '@/components/share/ShareDialog'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { NEW_AGENT_EVENT } from '@/shared/workspace/sidebar-events'
import { getAgentRuntimeLabel, indexActiveAgentBindings } from '../lib/agent-directory-runtime'
import { SHOWCASE_ALL_AGENTS } from '../lib/showcase-agents'
import { buildAgentEditorHref, startAgentChat } from '../lib/agent-chat'

type AgentTab = 'personal' | 'workspace' | 'archived'

function readTab(value: string | null): AgentTab {
  return value === 'personal' || value === 'archived' ? value : 'workspace'
}

function isPersonal(agent: WorkspaceAgentDirectoryItem): boolean {
  return agent.visibility === 'creator'
}

export function AgentsDirectory({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkedAgentId = searchParams?.get('agentId') ?? null
  const tab = readTab(searchParams?.get('tab'))
  const { activeWorkspaceId } = useWorkspace()
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>(showcase ? SHOWCASE_ALL_AGENTS : [])
  const [activeBindingsByAgentId, setActiveBindingsByAgentId] = useState<ReadonlyMap<string, AgentBinding>>(() => new Map())
  const [canCreate, setCanCreate] = useState(showcase)
  const [loading, setLoading] = useState(!showcase)
  const [sharingAgent, setSharingAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (showcase) return
    if (!activeWorkspaceId) return
    setLoading(true)
    try {
      const [directory, bindingResult] = await Promise.all([
        overlayAppClient.agents.list(activeWorkspaceId, { includeArchived: true }),
        overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId)
          .then((result) => ({ bindings: result.bindings }))
          .catch(() => ({ bindings: [] as AgentBinding[] })),
      ])
      setAgents(directory.agents)
      setActiveBindingsByAgentId(indexActiveAgentBindings(bindingResult.bindings))
      setCanCreate(directory.canCreate)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load agents.')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, showcase])

  useEffect(() => { void load() }, [load])

  const openCreatePage = useCallback(() => {
    const base = buildAgentEditorHref(activeWorkspaceId, 'new', showcase)
    router.push(tab === 'personal' ? `${base}?scope=creator` : base)
  }, [activeWorkspaceId, router, showcase, tab])

  const openEditPage = useCallback((agentId: string) => {
    router.push(buildAgentEditorHref(activeWorkspaceId, agentId, showcase))
  }, [activeWorkspaceId, router, showcase])

  // Deep link from global search: land on the editor page, then drop the
  // param so a refresh does not redirect again. Archived agents have no
  // editor (the service refuses edits), so they never redirect.
  useEffect(() => {
    if (!deepLinkedAgentId || loading) return
    if (showcase && !SHOWCASE_ALL_AGENTS.some((agent) => agent.id === deepLinkedAgentId && !agent.archivedAt)) return
    if (!showcase && !activeWorkspaceId) return
    if (!showcase && !agents.some((candidate) => candidate.id === deepLinkedAgentId && !candidate.archivedAt)) return
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('agentId')
    const queryString = params.toString()
    router.replace(queryString ? `${buildAgentEditorHref(activeWorkspaceId, deepLinkedAgentId, showcase)}?${queryString}` : buildAgentEditorHref(activeWorkspaceId, deepLinkedAgentId, showcase))
  }, [activeWorkspaceId, agents, deepLinkedAgentId, loading, router, searchParams, showcase])

  useEffect(() => {
    window.addEventListener(NEW_AGENT_EVENT, openCreatePage)
    return () => window.removeEventListener(NEW_AGENT_EVENT, openCreatePage)
  }, [openCreatePage])

  async function startChat(agent: WorkspaceAgentDirectoryItem) {
    setError(null)
    try {
      await startAgentChat({
        workspaceId: activeWorkspaceId,
        agentPrincipalId: showcase ? agent.id : agent.principalId,
        showcase,
        push: (href) => router.push(href),
      })
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    }
  }

  const visibleAgents = tab === 'personal'
    ? agents.filter((agent) => !agent.archivedAt && isPersonal(agent))
    : tab === 'archived'
      ? agents.filter((agent) => agent.archivedAt)
      : agents.filter((agent) => !agent.archivedAt && !isPersonal(agent))
  const emptyCopy: Record<AgentTab, { title: string; body: string }> = {
    personal: { title: 'No personal agents', body: 'Personal agents are only visible to you — in Overlay and on connected chat.' },
    workspace: { title: 'No workspace agents', body: 'Workspace agents are available to everyone in this workspace.' },
    archived: { title: 'No archived agents', body: 'Archived agents keep their history but leave rooms and teams.' },
  }

  return (
    <>
      <AppScreenShell
      header={
        <AppScreenHeader
          title="Agents"
          actions={canCreate && tab !== 'archived' ? <Button variant="secondary" onClick={openCreatePage}><Plus size={14} /> New agent</Button> : null}
        />
      }
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
        {error ? <div className="mb-5 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-xs text-red-500">{error}</div> : null}
        {loading ? (
          <TileGrid columns={3}>{[0, 1, 2].map((value) => <TileSkeleton key={value} className="min-h-52" />)}</TileGrid>
        ) : visibleAgents.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">{emptyCopy[tab].title}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{emptyCopy[tab].body}</p>
            {canCreate && tab !== 'archived' ? <Button variant="secondary" size="sm" className="mt-4" onClick={openCreatePage}><Plus size={14} /> New agent</Button> : null}
          </div>
        ) : (
          <TileGrid columns={3}>
            {visibleAgents.map((agent) => {
              const isDefaultMaster = Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay')
              const personal = isPersonal(agent)
              const archived = Boolean(agent.archivedAt)
              const runtimeLabel = getAgentRuntimeLabel(agent.modelId, activeBindingsByAgentId.get(agent.id))
              const ownerLine = !isDefaultMaster && agent.createdByDisplayName
                ? `by ${agent.createdByDisplayName} · `
                : ''
              return (
                <Tile
                  key={agent.id}
                  as="article"
                  className="min-h-52 p-5"
                  leading={(
                    <div className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: agent.avatarColor ?? '#18181b' }}><Bot size={22} strokeWidth={1.5} /></div>
                  )}
                  topRight={isDefaultMaster || personal || (archived && tab === 'archived') ? (
                    <span className="flex items-center gap-1.5">
                      {personal ? <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">Personal</span> : null}
                      {tab === 'archived' && !personal ? <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">Workspace</span> : null}
                      {isDefaultMaster ? <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)]">Master Agent</span> : null}
                    </span>
                  ) : null}
                  title={<span className="text-base">{agent.name}</span>}
                  description={agent.description ?? agent.instructions}
                  footer={(
                    <>
                      <div className="min-w-0 flex-1"><span className="block truncate" title={runtimeLabel}>{runtimeLabel}</span><span>{ownerLine}{agent.roomCount} {agent.roomCount === 1 ? 'room' : 'rooms'}</span></div>
                      {!archived ? (
                        <div className="flex shrink-0 items-center gap-1">
                          {!showcase ? <Button variant="ghost" size="sm" onClick={() => setSharingAgent(agent)}><Share2 size={13} /> Share</Button> : null}
                          <Button variant="ghost" size="sm" onClick={() => void startChat(agent)}><MessageSquare size={13} /> Chat</Button>
                        </div>
                      ) : null}
                    </>
                  )}
                >
                  {!archived ? <button type="button" onClick={() => openEditPage(agent.id)} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-light)] opacity-0 transition-opacity hover:bg-[var(--surface-subtle)] group-hover:opacity-100" aria-label={`Edit ${agent.name}`}><MoreHorizontal size={15} /></button> : null}
                </Tile>
              )
            })}
            {canCreate && tab !== 'archived' ? (
              <CreateTile label="New agent" className="min-h-52" onClick={openCreatePage} />
            ) : null}
          </TileGrid>
        )}
      </AppScreenBody>
      </AppScreenShell>
      <ShareDialog
        workspaceId={activeWorkspaceId}
        isOpen={Boolean(sharingAgent)}
        onClose={() => setSharingAgent(null)}
        resource={sharingAgent ? {
          id: sharingAgent.id,
          type: 'agent',
          title: sharingAgent.name,
        } : null}
      />
    </>
  )
}
