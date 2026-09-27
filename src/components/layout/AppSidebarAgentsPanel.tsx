'use client'

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArchiveRestore,
  ChevronRight,
  Loader2,
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
import {
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatCreated,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import {
  arrayOrEmpty,
  agentThreadHref,
  resourceRowClass,
  type AgentsPanelView,
} from './sidebar-nav'
import { AgentThreadRows } from './AppSidebarAgentThreads'

type AgentBundleMap = Record<string, WorkspaceAgentBundle | 'loading' | 'error'>

function useAgentBundles(workspaceId: string | null) {
  const [bundles, setBundles] = useState<AgentBundleMap>({})

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

  // A first-message rename applies the generated title to the thread row it
  // belongs to without refetching the whole bundle.
  useEffect(() => {
    const onTitleUpdated = (event: Event) => {
      const { chatId, title } = (event as CustomEvent<ChatTitleUpdatedDetail>).detail ?? {}
      if (!chatId || !title) return
      setBundles((current) => {
        let touched = false
        const next = { ...current }
        for (const agentId of Object.keys(next)) {
          const bundle = next[agentId]
          if (!bundle || typeof bundle !== 'object') continue
          if (!bundle.threads.some((thread) => thread.conversationId === chatId)) continue
          next[agentId] = {
            ...bundle,
            threads: bundle.threads.map((thread) =>
              thread.conversationId === chatId ? { ...thread, title } : thread),
          }
          touched = true
        }
        return touched ? next : current
      })
    }
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
    return () => window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
  }, [])

  return { bundles, setBundles, loadBundle }
}

function useExpandedAgents({
  activeAgentId,
  bundles,
  loadBundle,
}: {
  activeAgentId: string | null
  bundles: AgentBundleMap
  loadBundle: (agentId: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // The agent in the URL stays expanded so its threads remain in view.
  if (activeAgentId && !expanded.has(activeAgentId)) {
    setExpanded((current) => new Set(current).add(activeAgentId))
  }
  useEffect(() => {
    if (!activeAgentId || !(activeAgentId in bundles)) return
    void loadBundle(activeAgentId)
  }, [activeAgentId, bundles, loadBundle])

  const toggleExpanded = useCallback((agentId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
    if (!(agentId in bundles)) void loadBundle(agentId)
  }, [bundles, loadBundle])

  return { expanded, toggleExpanded }
}

function useAgentDirectory(
  workspaceId: string | null,
  expanded: Set<string>,
  loadBundle: (agentId: string) => Promise<void>,
  setBundles: Dispatch<SetStateAction<AgentBundleMap>>,
) {
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>([])
  const [viewerPrincipalId, setViewerPrincipalId] = useState<string | null>(null)
  const [archivedThreadAgentIds, setArchivedThreadAgentIds] = useState<Set<string>>(new Set())
  const [draftPreviews, setDraftPreviews] = useState<Record<string, AgentDraftPreviewPatch>>({})
  const [loading, setLoading] = useState(true)

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

  useEffect(() => { void loadAgents() }, [loadAgents])

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
  }, [expanded, loadAgents, loadBundle, setBundles, workspaceId])

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

  return { agents, viewerPrincipalId, archivedThreadAgentIds, setArchivedThreadAgentIds, draftPreviews, loading }
}

function useAgentActions({
  workspaceId,
  baseHref,
  onNavigate,
  bundles,
  setBundles,
  loadBundle,
  activeAgentId,
  activeConversationId,
  sortedAgents,
  setArchivedThreadAgentIds,
}: {
  workspaceId: string | null
  baseHref: string
  onNavigate?: () => void
  bundles: AgentBundleMap
  setBundles: Dispatch<SetStateAction<AgentBundleMap>>
  loadBundle: (agentId: string) => Promise<void>
  activeAgentId: string | null
  activeConversationId: string | null
  sortedAgents: WorkspaceAgentDirectoryItem[]
  setArchivedThreadAgentIds: Dispatch<SetStateAction<Set<string>>>
}) {
  const router = useRouter()
  const [openingAgentId, setOpeningAgentId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [creatingThreadFor, setCreatingThreadFor] = useState<string | null>(null)

  useEffect(() => {
    setOpenError(null)
  }, [workspaceId])

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
  }, [baseHref, creatingThreadFor, onNavigate, router, setBundles, workspaceId])

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
  }, [bundles, loadBundle, setArchivedThreadAgentIds, setBundles, workspaceId])

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
  }, [activeConversationId, baseHref, bundles, loadBundle, router, setArchivedThreadAgentIds, setBundles, workspaceId])

  const restoreAgent = useCallback(async (agent: WorkspaceAgentDirectoryItem) => {
    if (!workspaceId) return
    try {
      await overlayAppClient.agents.restore(workspaceId, agent.id)
      dispatchAgentDirectoryChanged(workspaceId)
    } catch {
      setOpenError(`Could not restore ${agent.name}. Check your connection and retry.`)
    }
  }, [workspaceId])

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

  return {
    openingAgentId,
    openError,
    creatingThreadFor,
    openAgentById,
    openThread,
    createThread,
    archiveThread,
    deleteThread,
    restoreAgent,
    retryOpen,
  }
}

function AgentListRow({
  agent,
  view,
  isExpanded,
  isActive,
  anyOpening,
  isOpening,
  bundle,
  activeConversationId,
  creatingThread,
  onToggleExpanded,
  onOpenAgent,
  onRestoreAgent,
  onOpenThread,
  onCreateThread,
  onArchiveThread,
  onDeleteThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  view: AgentsPanelView
  isExpanded: boolean
  isActive: boolean
  anyOpening: boolean
  isOpening: boolean
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  creatingThread: boolean
  onToggleExpanded: (agentId: string) => void
  onOpenAgent: (agent: WorkspaceAgentDirectoryItem) => void
  onRestoreAgent: (agent: WorkspaceAgentDirectoryItem) => void
  onOpenThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string) => void
  onCreateThread: (agent: WorkspaceAgentDirectoryItem) => void
  onArchiveThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean) => void
  onDeleteThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string) => void
}) {
  return (
    <div>
      <div className="group/agent relative">
        <button
          type="button"
          disabled={anyOpening}
          className={`${resourceRowClass} pr-7 ${isActive ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
          onClick={() => {
            if (!isExpanded) onToggleExpanded(agent.id)
            onOpenAgent(agent)
          }}
        >
          {isOpening
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
                onRestoreAgent(agent)
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
              onToggleExpanded(agent.id)
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
          bundle={bundle}
          view={view}
          activeConversationId={activeConversationId}
          onOpenThread={onOpenThread}
          onCreateThread={onCreateThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          creatingThread={creatingThread}
        />
      ) : null}
    </div>
  )
}

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
  const searchParams = useSearchParams()
  const activeAgentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const activeConversationId = searchParams?.get('id') ?? null

  const { bundles, setBundles, loadBundle } = useAgentBundles(workspaceId)
  const { expanded, toggleExpanded } = useExpandedAgents({ activeAgentId, bundles, loadBundle })
  const {
    agents,
    viewerPrincipalId,
    archivedThreadAgentIds,
    setArchivedThreadAgentIds,
    draftPreviews,
    loading,
  } = useAgentDirectory(workspaceId, expanded, loadBundle, setBundles)

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

  const {
    openingAgentId,
    openError,
    creatingThreadFor,
    openAgentById,
    openThread,
    createThread,
    archiveThread,
    deleteThread,
    restoreAgent,
    retryOpen,
  } = useAgentActions({
    workspaceId,
    baseHref,
    onNavigate,
    bundles,
    setBundles,
    loadBundle,
    activeAgentId,
    activeConversationId,
    sortedAgents,
    setArchivedThreadAgentIds,
  })

  // Remember agents opened through direct links or refreshes so recency
  // ordering covers every entry path. Initial conversation selection lives
  // in AgentConversationWorkspace (single owner); the sidebar only opens on
  // explicit clicks.
  useEffect(() => {
    if (activeAgentId && sortedAgents.some((agent) => agent.id === activeAgentId)) {
      rememberAgentOpened(workspaceId, activeAgentId)
    }
  }, [activeAgentId, sortedAgents, workspaceId])

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
            <AgentListRow
              key={agent.id}
              agent={agent}
              view={view}
              isExpanded={isExpanded}
              isActive={activeAgentId === agent.id && !activeConversationId}
              anyOpening={Boolean(openingAgentId)}
              isOpening={openingAgentId === agent.id}
              bundle={bundles[agent.id] ?? 'loading'}
              activeConversationId={activeConversationId}
              creatingThread={creatingThreadFor === agent.id}
              onToggleExpanded={toggleExpanded}
              onOpenAgent={(target) => void openAgentById(target)}
              onRestoreAgent={(target) => void restoreAgent(target)}
              onOpenThread={openThread}
              onCreateThread={(target) => void createThread(target)}
              onArchiveThread={(target, conversationId, archived) => {
                void archiveThread(target, conversationId, archived)
              }}
              onDeleteThread={(target, conversationId) => {
                void deleteThread(target, conversationId)
              }}
            />
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
