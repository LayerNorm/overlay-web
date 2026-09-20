'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Loader2,
  User,
  Users,
} from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { SidebarResourceList } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { AgentCreature } from '@/components/orb/Creature'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  AGENT_DRAFT_PREVIEW_EVENT,
  dispatchAgentDirectoryChanged,
  type AgentDirectoryChangedEventDetail,
  type AgentDraftPreviewEventDetail,
  type AgentDraftPreviewPatch,
} from '@/shared/workspace/sidebar-events'
import {
  getAgentOpenedAt,
  getLastOpenedAgentId,
  rememberAgentOpened,
  sortAgentsByRecency,
} from '@/shared/agents/last-agent-by-workspace'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { arrayOrEmpty } from './AppSidebarInlinePanels'
import {
  AgentThreadRows,
  agentThreadHref,
  resourceRowClass,
  type AgentsPanelView,
} from './AppSidebarAgentThreads'

export function AgentsInlinePanel({
  workspaceId,
  baseHref = '/app/agents',
  view = 'personal',
  onNavigate,
}: {
  workspaceId: string | null
  baseHref?: string
  view?: AgentsPanelView
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>([])
  const [viewerPrincipalId, setViewerPrincipalId] = useState<string | null>(null)
  const [archivedThreadAgentIds, setArchivedThreadAgentIds] = useState<Set<string>>(new Set())
  const [draftPreviews, setDraftPreviews] = useState<Record<string, AgentDraftPreviewPatch>>({})
  const [loading, setLoading] = useState(true)
  const [openingAgentId, setOpeningAgentId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [bundles, setBundles] = useState<Record<string, WorkspaceAgentBundle | 'loading' | 'error'>>({})
  const [creatingThreadFor, setCreatingThreadFor] = useState<string | null>(null)
  const activeAgentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const activeConversationId = searchParams?.get('id') ?? null

  // Unsaved editor drafts overlay the fetched directory so the row renames and
  // re-skins while the user types; the override clears on save/cancel/close.
  const previewedAgents = useMemo(
    () => agents.map((agent) => {
      const patch = draftPreviews[agent.id]
      return patch ? { ...agent, ...patch } : agent
    }),
    [agents, draftPreviews],
  )

  // Tab bucketing: the Archived tab holds archived agents plus live agents
  // that own archived threads; live agents split into Personal (created by
  // me) and Workspace (the rest).
  const tabAgents = useMemo(
    () => previewedAgents.filter((agent) => {
      if (view === 'archived') {
        return Boolean(agent.archivedAt) || archivedThreadAgentIds.has(agent.id)
      }
      if (agent.archivedAt) return false
      return view === 'personal'
        ? agent.createdByPrincipalId === viewerPrincipalId
        : agent.createdByPrincipalId !== viewerPrincipalId
    }),
    [previewedAgents, view, viewerPrincipalId, archivedThreadAgentIds],
  )

  // Most recently used first; agents with no recorded use stay alphabetical.
  const sortedAgents = useMemo(
    () => sortAgentsByRecency(tabAgents, getAgentOpenedAt(workspaceId)),
    [tabAgents, workspaceId],
  )

  const loadAgents = useCallback(async (showLoading = true) => {
    if (!workspaceId) {
      setAgents([])
      setViewerPrincipalId(null)
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    try {
      const response = await overlayAppClient.agents.list(workspaceId, { includeArchived: true })
      setAgents(arrayOrEmpty<WorkspaceAgentDirectoryItem>(response.agents))
      setViewerPrincipalId(response.viewerPrincipalId ?? null)
      setArchivedThreadAgentIds(new Set(response.archivedThreadAgentIds ?? []))
    } catch {
      setAgents([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [workspaceId])

  const loadBundle = useCallback(async (agentId: string) => {
    if (!workspaceId) return
    setBundles((current) => ({ ...current, [agentId]: 'loading' }))
    try {
      const bundle = await overlayAppClient.agents.bundle(workspaceId, agentId)
      setBundles((current) => ({ ...current, [agentId]: bundle }))
    } catch {
      setBundles((current) => ({ ...current, [agentId]: 'error' }))
    }
  }, [workspaceId])

  useEffect(() => { void loadAgents() }, [loadAgents])

  useEffect(() => {
    setOpenError(null)
  }, [workspaceId])

  useEffect(() => {
    const refreshAgents = (event: Event) => {
      const changedWorkspaceId = (event as CustomEvent<AgentDirectoryChangedEventDetail>).detail?.workspaceId
      if (changedWorkspaceId && changedWorkspaceId !== workspaceId) return
      void loadAgents(false)
      // Agent lifecycle events (rename/archive/restore) can change what the
      // expanded bundles contain — refetch them rather than diffing.
      setBundles((current) => {
        for (const agentId of Object.keys(current)) {
          if (expanded.has(agentId)) void loadBundle(agentId)
        }
        return current
      })
    }
    window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
    return () => window.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
  }, [expanded, loadAgents, loadBundle, workspaceId])

  // The agent in the URL stays expanded so its threads remain in view.
  useEffect(() => {
    if (!activeAgentId || expanded.has(activeAgentId)) return
    setExpanded((current) => new Set(current).add(activeAgentId))
    if (!(activeAgentId in bundles)) void loadBundle(activeAgentId)
  }, [activeAgentId, bundles, expanded, loadBundle])

  useEffect(() => {
    setDraftPreviews({})
    const onDraftPreview = (event: Event) => {
      const detail = (event as CustomEvent<AgentDraftPreviewEventDetail>).detail
      if (!detail || detail.workspaceId !== workspaceId) return
      setDraftPreviews((current) => {
        const next = { ...current }
        if (detail.patch) next[detail.agentId] = detail.patch
        else delete next[detail.agentId]
        return next
      })
    }
    window.addEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
    return () => window.removeEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
  }, [workspaceId])

  const toggleExpanded = useCallback((agentId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
    if (!(agentId in bundles)) void loadBundle(agentId)
  }, [bundles, loadBundle])

  const openAgent = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    navigation: 'push' | 'replace' = 'push',
  ) => {
    if (openingAgentId) return
    setOpeningAgentId(agent.id)
    try {
      if (!workspaceId) return
      // Agents open into their main thread; the resolver adopts the legacy
      // DM or creates the first thread when the agent has none yet.
      const { thread } = await overlayAppClient.agents.resolveMainThread(workspaceId, agent.id)
      rememberAgentOpened(workspaceId, agent.id)
      setOpenError(null)
      dispatchChatCreated({
        chat: {
          _id: thread.conversationId,
          title: thread.title,
          lastModified: Date.now(),
          conversationType: 'dm',
        },
      })
      const href = agentThreadHref(baseHref, agent.id, thread.conversationId)
      if (navigation === 'replace') router.replace(href)
      else router.push(href)
      if (navigation === 'push') onNavigate?.()
    } finally {
      setOpeningAgentId(null)
    }
  }, [baseHref, onNavigate, openingAgentId, router, workspaceId])

  const openThread = useCallback((
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    rememberAgentOpened(workspaceId, agent.id)
    router.push(agentThreadHref(baseHref, agent.id, conversationId))
    onNavigate?.()
  }, [baseHref, onNavigate, router, workspaceId])

  const createThread = useCallback(async (agent: WorkspaceAgentDirectoryItem) => {
    if (!workspaceId || creatingThreadFor) return
    setCreatingThreadFor(agent.id)
    try {
      const { thread } = await overlayAppClient.agents.createThread(workspaceId, agent.id, {})
      rememberAgentOpened(workspaceId, agent.id)
      setBundles((current) => {
        const existing = current[agent.id]
        if (existing === 'loading' || existing === 'error' || !existing) return current
        return {
          ...current,
          [agent.id]: {
            ...existing,
            threads: [{
              conversationId: thread.conversationId,
              title: thread.title,
              lastModified: Date.now(),
              createdAt: Date.now(),
              isMain: false,
            }, ...existing.threads],
          },
        }
      })
      router.push(agentThreadHref(baseHref, agent.id, thread.conversationId))
      onNavigate?.()
    } finally {
      setCreatingThreadFor(null)
    }
  }, [baseHref, creatingThreadFor, onNavigate, router, workspaceId])

  const archiveThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
    archived: boolean,
  ) => {
    if (!workspaceId) return
    try {
      await overlayAppClient.agents.setThreadArchived(workspaceId, agent.id, conversationId, archived)
      const existing = bundles[agent.id]
      if (existing && existing !== 'loading' && existing !== 'error') {
        // The Archived tab shows live agents that still own archived threads;
        // keep the membership set in step with the local bundle state.
        const stillArchived = existing.threads.some((thread) => (
          thread.conversationId === conversationId ? archived : Boolean(thread.archivedAt)
        ))
        setArchivedThreadAgentIds((ids) => {
          const next = new Set(ids)
          if (stillArchived) next.add(agent.id)
          else next.delete(agent.id)
          return next
        })
      }
      setBundles((current) => {
        const entry = current[agent.id]
        if (entry === 'loading' || entry === 'error' || !entry) return current
        return {
          ...current,
          [agent.id]: {
            ...entry,
            threads: entry.threads.map((thread) => (
              thread.conversationId === conversationId
                ? { ...thread, archivedAt: archived ? Date.now() : undefined }
                : thread
            )),
          },
        }
      })
    } catch {
      void loadBundle(agent.id)
    }
  }, [bundles, loadBundle, workspaceId])

  const deleteThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    if (!workspaceId) return
    try {
      await overlayAppClient.agents.deleteThread(workspaceId, agent.id, conversationId)
      const existing = bundles[agent.id]
      if (existing && existing !== 'loading' && existing !== 'error') {
        const stillArchived = existing.threads.some((thread) => (
          thread.conversationId !== conversationId && Boolean(thread.archivedAt)
        ))
        setArchivedThreadAgentIds((ids) => {
          const next = new Set(ids)
          if (stillArchived) next.add(agent.id)
          else next.delete(agent.id)
          return next
        })
      }
      setBundles((current) => {
        const existing = current[agent.id]
        if (existing === 'loading' || existing === 'error' || !existing) return current
        let threads = existing.threads.filter((thread) => thread.conversationId !== conversationId)
        // When the main thread goes away the oldest survivor becomes main.
        if (threads.length && !threads.some((thread) => thread.isMain)) {
          const oldest = threads.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
          threads = threads.map((thread) => (
            thread.conversationId === oldest.conversationId ? { ...thread, isMain: true } : thread
          ))
        }
        return { ...current, [agent.id]: { ...existing, threads } }
      })
      // Deleting the thread being viewed must bounce to the surviving main
      // thread — otherwise the surface keeps rendering a deleted
      // conversation. Bare `?agent=` is avoided because the surface's live
      // directory cannot resolve archived agents.
      if (activeConversationId === conversationId) {
        const survivors = bundles[agent.id]
        const next = survivors && survivors !== 'loading' && survivors !== 'error'
          ? survivors.threads
            .filter((thread) => thread.conversationId !== conversationId)
            .sort((a, b) => a.createdAt - b.createdAt)[0]
          : undefined
        router.push(
          next
            ? agentThreadHref(baseHref, agent.id, next.conversationId)
            : `${baseHref}?agent=${encodeURIComponent(agent.id)}`,
        )
      }
    } catch {
      void loadBundle(agent.id)
    }
  }, [activeConversationId, baseHref, bundles, loadBundle, router, workspaceId])

  const restoreAgent = useCallback(async (agent: WorkspaceAgentDirectoryItem) => {
    if (!workspaceId) return
    try {
      await overlayAppClient.agents.restore(workspaceId, agent.id)
      dispatchAgentDirectoryChanged(workspaceId)
    } catch {
      setOpenError(`Could not restore ${agent.name}. Check your connection and retry.`)
    }
  }, [workspaceId])

  // Remember agents opened through direct links or refreshes so recency
  // ordering covers every entry path. Initial conversation selection lives
  // in AgentConversationWorkspace (single owner); the sidebar only opens on
  // explicit clicks.
  useEffect(() => {
    if (activeAgentId && sortedAgents.some((agent) => agent.id === activeAgentId)) {
      rememberAgentOpened(workspaceId, activeAgentId)
    }
  }, [activeAgentId, sortedAgents, workspaceId])

  const openAgentById = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    navigation: 'push' | 'replace' = 'push',
  ) => {
    try {
      await openAgent(agent, navigation)
    } catch {
      setOpenError(`Could not open ${agent.name}. Check your connection and retry.`)
    }
  }, [openAgent])

  const retryOpen = useCallback(() => {
    const lastOpenedId = getLastOpenedAgentId(workspaceId)
    const targetAgent = (activeAgentId ? sortedAgents.find((agent) => agent.id === activeAgentId) : undefined)
      ?? (lastOpenedId ? sortedAgents.find((agent) => agent.id === lastOpenedId) : undefined)
      ?? sortedAgents[0]
    if (!targetAgent) return
    setOpenError(null)
    void openAgentById(targetAgent, 'replace')
  }, [activeAgentId, openAgentById, sortedAgents, workspaceId])

  return (
    <SidebarResourceList>
      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--muted-light)]">
          <Loader2 size={13} className="animate-spin" /> Loading agents...
        </div>
      ) : sortedAgents.length ? (
        sortedAgents.map((agent) => {
          const isExpanded = expanded.has(agent.id)
          return (
            <div key={agent.id}>
              <div className="group/agent relative">
                <button
                  type="button"
                  disabled={Boolean(openingAgentId)}
                  className={`${resourceRowClass} pr-7 ${activeAgentId === agent.id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
                  onClick={() => {
                    if (!isExpanded) toggleExpanded(agent.id)
                    void openAgentById(agent)
                  }}
                >
                  {openingAgentId === agent.id
                    ? <Loader2 size={13} className="shrink-0 animate-spin" />
                    : <AgentCreature agent={agent} size={16} />}
                  <span className="truncate">{agent.name}</span>
                </button>
                <span className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                  {view === 'archived' && agent.archivedAt ? (
                    <button
                      type="button"
                      aria-label={`Restore ${agent.name}`}
                      title={`Restore ${agent.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        void restoreAgent(agent)
                      }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-light)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                    >
                      <ArchiveRestore size={12} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={isExpanded ? `Collapse ${agent.name}` : `Expand ${agent.name}`}
                    aria-expanded={isExpanded}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleExpanded(agent.id)
                    }}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-light)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>
                </span>
              </div>
              {isExpanded ? (
                <AgentThreadRows
                  agent={agent}
                  bundle={bundles[agent.id] ?? 'loading'}
                  view={view}
                  activeConversationId={activeConversationId}
                  onOpenThread={openThread}
                  onCreateThread={(target) => void createThread(target)}
                  onArchiveThread={(target, conversationId, archived) => {
                    void archiveThread(target, conversationId, archived)
                  }}
                  onDeleteThread={(target, conversationId) => {
                    void deleteThread(target, conversationId)
                  }}
                  creatingThread={creatingThreadFor === agent.id}
                />
              ) : null}
            </div>
          )
        })
      ) : (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">
          {view === 'archived' ? 'No archived agents' : view === 'personal' ? 'No personal agents yet' : 'No workspace agents yet'}
        </p>
      )}
      {openError ? (
        <div className="px-2.5 py-2">
          <p role="alert" className="text-xs leading-4 text-red-500">{openError}</p>
          <button
            type="button"
            onClick={retryOpen}
            className="mt-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
          >
            Retry
          </button>
        </div>
      ) : null}
    </SidebarResourceList>
  )
}

export const agentsInlineItems = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Users },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const

