'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, MessageSquare, MoreHorizontal, Plus, Share2, Users } from 'lucide-react'
import type { WorkspaceAgentCreateInput, WorkspaceAgentDirectoryItem, WorkspaceManagementItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { buildWorkspaceHref } from '@/features/workspaces/lib/workspace-routing'
import { useRouter } from 'next/navigation'
import { AgentEditorDialog } from './AgentEditorDialog'
import { ShareDialog } from '@/components/share/ShareDialog'

const SHOWCASE_AGENTS: WorkspaceAgentDirectoryItem[] = [
  ['showcase-research', 'Research partner', 'Finds primary evidence and challenges assumptions.', '#2563eb'],
  ['showcase-writer', 'Launch writer', 'Turns product decisions into clear customer-facing drafts.', '#7c3aed'],
  ['showcase-analyst', 'Product analyst', 'Synthesizes feedback, metrics, and experiment results.', '#059669'],
].map(([id, name, description, avatarColor], index) => ({
  id, workspaceId: 'showcase-acme', principalId: `${id}-principal`, name, description,
  instructions: description, harness: 'overlay', modelId: 'openrouter/free', avatarColor,
  allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'showcase-divyansh',
  createdAt: Date.parse('2026-07-29T18:00:00.000Z') + index, updatedAt: Date.parse('2026-07-29T18:00:00.000Z') + index,
  teamIds: index < 2 ? ['showcase-team-launch'] : [], roomCount: 2 + index,
}))
const SHOWCASE_TEAMS: WorkspaceManagementItem[] = [{
  id: 'showcase-team-launch', kind: 'team', name: 'Launch crew', description: 'Research and writing agents',
  teamMemberPrincipalIds: SHOWCASE_AGENTS.slice(0, 2).map((agent) => agent.principalId),
}]

export function AgentsDirectory({ showcase = false }: { showcase?: boolean }) {
  const router = useRouter()
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>(showcase ? SHOWCASE_AGENTS : [])
  const [teams, setTeams] = useState<WorkspaceManagementItem[]>(showcase ? SHOWCASE_TEAMS : [])
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
      const [directory, teamDirectory] = await Promise.all([
        overlayAppClient.agents.list(activeWorkspaceId),
        overlayAppClient.workspaces.management(activeWorkspaceId, 'teams'),
      ])
      setAgents(directory.agents)
      setCanCreate(directory.canCreate)
      setTeams(teamDirectory.items.filter((item) => item.kind === 'team'))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load agents.')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, showcase])

  useEffect(() => { void load() }, [load])

  const teamsWithAgents = useMemo(() => teams.map((team) => ({
    team,
    agents: agents.filter((agent) => agent.teamIds.includes(team.id)),
  })).filter(({ agents: members }) => members.length), [agents, teams])

  async function save(input: WorkspaceAgentCreateInput) {
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
      if (editing) await overlayAppClient.agents.update(activeWorkspaceId, editing.id, input)
      else await overlayAppClient.agents.create(activeWorkspaceId, input)
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
    <div className="min-h-full bg-[var(--background)] px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Create and manage named AI teammates for {showcase ? 'Acme' : activeWorkspace?.name ?? 'this workspace'}.</p>
          </div>
          {canCreate ? <Button variant="secondary" onClick={() => { setEditing(null); setError(null); setDialogOpen(true) }}><Plus size={14} /> New agent</Button> : null}
        </div>

        {error && !dialogOpen ? <div className="mt-5 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-xs text-red-500">{error}</div> : null}
        {loading ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((value) => <div key={value} className="h-52 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]" />)}</div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <article key={agent.id} className="group relative flex min-h-52 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-shadow hover:shadow-sm">
                <button type="button" onClick={() => { setEditing(agent); setError(null); setDialogOpen(true) }} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-light)] opacity-0 hover:bg-[var(--surface-subtle)] group-hover:opacity-100" aria-label={`Edit ${agent.name}`}><MoreHorizontal size={15} /></button>
                <div className="flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ backgroundColor: agent.avatarColor ?? '#64748b' }}><Bot size={24} strokeWidth={1.5} /></div>
                <h2 className="mt-5 font-medium">{agent.name}</h2>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{agent.description ?? agent.instructions}</p>
                <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                  <div className="text-[10px] text-[var(--muted-light)]"><span className="block truncate">{agent.modelId}</span><span>{agent.roomCount} {agent.roomCount === 1 ? 'room' : 'rooms'}</span></div>
                  <div className="flex items-center gap-1">
                    {!showcase ? <Button variant="ghost" size="sm" onClick={() => setSharingAgent(agent)}><Share2 size={13} /> Share</Button> : null}
                    <Button variant="ghost" size="sm" onClick={() => void startChat(agent)}><MessageSquare size={13} /> Chat</Button>
                  </div>
                </div>
              </article>
            ))}
            {canCreate ? (
              <button type="button" onClick={() => { setEditing(null); setError(null); setDialogOpen(true) }} className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><Plus size={22} /><span className="mt-2">New agent</span></button>
            ) : null}
          </div>
        )}

        {teamsWithAgents.length ? (
          <section className="mt-12 border-t border-[var(--border)] pt-8">
            <div className="flex items-center gap-2"><Users size={16} /><h2 className="text-lg font-semibold">Agent teams</h2></div>
            <p className="mt-1 text-xs text-[var(--muted)]">Reusable groups you can add to rooms and share resources with together.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {teamsWithAgents.map(({ team, agents: members }) => (
                <div key={team.id} className="rounded-xl border border-[var(--border)] p-4">
                  <p className="text-sm font-medium">{team.name}</p>
                  <div className="mt-3 flex -space-x-2">
                    {members.map((agent) => <div key={agent.id} title={agent.name} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--background)] text-white" style={{ backgroundColor: agent.avatarColor ?? '#64748b' }}><Bot size={14} /></div>)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      {dialogOpen ? <AgentEditorDialog key={editing?.id ?? 'new'} open agent={editing} teams={teams} busy={busy} error={error} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null) }} onSave={(input) => void save(input)} onArchive={editing ? () => void archiveAgent() : undefined} /> : null}
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
    </div>
  )
}
