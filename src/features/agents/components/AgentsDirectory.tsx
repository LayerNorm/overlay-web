'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, MessageSquare, MoreHorizontal, Plus, Share2 } from 'lucide-react'
import type { WorkspaceAgentCreateInput, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { buildWorkspaceHref } from '@/features/workspaces/lib/workspace-routing'
import { useRouter, useSearchParams } from 'next/navigation'
import { AgentEditorDialog } from './AgentEditorDialog'
import { ShareDialog } from '@/components/share/ShareDialog'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { dispatchAgentDirectoryChanged, NEW_AGENT_EVENT } from '@/shared/workspace/sidebar-events'
import { dispatchChatCreated } from '@/shared/chat/chat-title'

const SHOWCASE_AGENTS: WorkspaceAgentDirectoryItem[] = [
  ['showcase-research', 'Research partner', 'Finds primary evidence and challenges assumptions.', '#2563eb'],
  ['showcase-writer', 'Launch writer', 'Turns product decisions into clear customer-facing drafts.', '#7c3aed'],
  ['showcase-analyst', 'Product analyst', 'Synthesizes feedback, metrics, and experiment results.', '#059669'],
].map(([id, name, description, avatarColor], index) => ({
  id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name, description,
  instructions: description, harness: 'overlay', modelId: 'openrouter/free', avatarColor,
  allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'showcase-divyansh',
  createdAt: Date.parse('2026-07-29T18:00:00.000Z') + index, updatedAt: Date.parse('2026-07-29T18:00:00.000Z') + index,
  teamIds: [], roomCount: 2 + index,
}))

export function AgentsDirectory({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkedAgentId = searchParams?.get('agentId') ?? null
  const { activeWorkspaceId } = useWorkspace()
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>(showcase ? SHOWCASE_AGENTS : [])
  const [canCreate, setCanCreate] = useState(showcase)
  const [loading, setLoading] = useState(!showcase)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [sharingAgent, setSharingAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (showcase) return
    if (!activeWorkspaceId) return
    setLoading(true)
    try {
      const directory = await overlayAppClient.agents.list(activeWorkspaceId)
      setAgents(directory.agents)
      setCanCreate(directory.canCreate)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load agents.')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, showcase])

  useEffect(() => { void load() }, [load])

  // Deep link from global search: open the editor for the requested agent once
  // the directory has loaded, then drop the param so a refresh does not reopen it.
  useEffect(() => {
    if (!deepLinkedAgentId || loading) return
    const agent = agents.find((candidate) => candidate.id === deepLinkedAgentId)
    if (!agent) return
    setEditing(agent)
    setError(null)
    setDialogOpen(true)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('agentId')
    const queryString = params.toString()
    router.replace(queryString ? `?${queryString}` : window.location.pathname, { scroll: false })
  }, [agents, deepLinkedAgentId, loading, router, searchParams])

  useEffect(() => {
    const openCreateDialog = () => {
      setEditing(null)
      setError(null)
      setDialogOpen(true)
    }
    window.addEventListener(NEW_AGENT_EVENT, openCreateDialog)
    return () => window.removeEventListener(NEW_AGENT_EVENT, openCreateDialog)
  }, [])

  async function save(input: WorkspaceAgentCreateInput, binding?: {
    environmentId: string
    adapterId: string
    workingDirectory: string
  } | null) {
    if (showcase) {
      const now = Date.now()
      if (editing) {
        setAgents((current) => current.map((agent) => agent.id === editing.id
          ? { ...agent, ...input, harness: input.harness ?? agent.harness, teamIds: input.teamIds ?? agent.teamIds, updatedAt: now }
          : agent))
      } else {
        const id = `showcase-agent-${now}`
        setAgents((current) => [...current, {
          id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name: input.name,
          description: input.description, instructions: input.instructions, harness: input.harness ?? 'overlay',
          modelId: input.modelId, avatarColor: input.avatarColor, allowedToolIds: input.allowedToolIds ?? [],
          invocationPolicy: 'mention', createdByPrincipalId: 'showcase-divyansh', createdAt: now, updatedAt: now,
          teamIds: input.teamIds ?? [], roomCount: 1,
        }])
      }
      setDialogOpen(false)
      setEditing(null)
      return
    }
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      const saved = editing
        ? await overlayAppClient.agents.update(activeWorkspaceId, editing.id, input)
        : await overlayAppClient.agents.create(activeWorkspaceId, input)
      if (binding) {
        try {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            ...binding,
          })
        } catch (bindingError) {
          // Agent identity may already be durable even if its remote binding
          // fails. Retry as an edit so we never create a duplicate identity.
          setEditing(saved.agent)
          throw bindingError
        }
      } else if (binding === null && editing) {
        await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
      }
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      setDialogOpen(false)
      setEditing(null)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
    } finally {
      setBusy(false)
    }
  }

  async function startChat(agent: WorkspaceAgentDirectoryItem) {
    if (showcase) {
      router.push(`/app/chat?showcase=1&view=dms&id=${encodeURIComponent(agent.id)}`)
      return
    }
    if (!activeWorkspaceId) return
    setError(null)
    try {
      const { directMessage } = await overlayAppClient.conversations.createDirectMessage({
        principalIds: [agent.principalId],
      })
      dispatchChatCreated({
        chat: {
          _id: directMessage.conversationId,
          title: directMessage.title,
          lastModified: Date.now(),
          conversationType: 'dm',
        },
      })
      router.push(`${buildWorkspaceHref(activeWorkspaceId, '/app/chat')}?view=dms&id=${encodeURIComponent(directMessage.conversationId)}`)
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    }
  }

  async function archiveAgent() {
    if (showcase && editing) {
      setAgents((current) => current.filter((agent) => agent.id !== editing.id))
      setDialogOpen(false)
      setEditing(null)
      return
    }
    if (!activeWorkspaceId || !editing || busy) return
    if (!window.confirm(`Archive ${editing.name}? It will leave rooms and teams, but its message history will remain.`)) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.agents.archive(activeWorkspaceId, editing.id)
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      setDialogOpen(false)
      setEditing(null)
      await load()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not archive agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AppScreenShell
      header={
        <AppScreenHeader
          title="Agents"
          actions={canCreate ? <Button variant="secondary" onClick={() => { setEditing(null); setError(null); setDialogOpen(true) }}><Plus size={14} /> New agent</Button> : null}
          className="px-6"
        />
      }
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
        {error && !dialogOpen ? <div className="mb-5 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-xs text-red-500">{error}</div> : null}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((value) => <div key={value} className="h-52 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]" />)}</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const isDefaultMaster = Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay')
              const isByo = agent.modelId.startsWith('byo/')
              return (
                <article key={agent.id} className="group relative flex min-h-52 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-shadow hover:shadow-sm">
                  <button type="button" onClick={() => { setEditing(agent); setError(null); setDialogOpen(true) }} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-light)] opacity-0 hover:bg-[var(--surface-subtle)] group-hover:opacity-100" aria-label={`Edit ${agent.name}`}><MoreHorizontal size={15} /></button>
                  <div className="flex items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: agent.avatarColor ?? '#18181b' }}><Bot size={22} strokeWidth={1.5} /></div>
                    {isDefaultMaster ? (
                      <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)]">Master Agent</span>
                    ) : null}
                  </div>
                  <h2 className="mt-4 font-medium">{agent.name}</h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{agent.description ?? agent.instructions}</p>
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-5">
                    <div className="min-w-0 flex-1 text-[10px] text-[var(--muted-light)]"><span className="block truncate" title={agent.modelId}>{isByo ? `${agent.modelId.slice(4)} · connected` : agent.modelId}</span><span>{agent.roomCount} {agent.roomCount === 1 ? 'room' : 'rooms'}</span></div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!showcase ? <Button variant="ghost" size="sm" onClick={() => setSharingAgent(agent)}><Share2 size={13} /> Share</Button> : null}
                      <Button variant="ghost" size="sm" onClick={() => void startChat(agent)}><MessageSquare size={13} /> Chat</Button>
                    </div>
                  </div>
                </article>
              )
            })}
            {canCreate ? (
              <button type="button" onClick={() => { setEditing(null); setError(null); setDialogOpen(true) }} className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><Plus size={22} /><span className="mt-2">New agent</span></button>
            ) : null}
          </div>
        )}
      </AppScreenBody>
      </AppScreenShell>
      {dialogOpen ? <AgentEditorDialog key={editing?.id ?? 'new'} open agent={editing} showcase={showcase} teams={[]} busy={busy} error={error} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null) }} onSave={(input, binding) => void save(input, binding)} onArchive={editing ? () => void archiveAgent() : undefined} /> : null}
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
