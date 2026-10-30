'use client'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { readWorkspacePathScope } from '@/shared/workspaces/routing'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronRight,
  Loader2,
  Plus,
} from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, Button } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { announceArchived } from '@/shared/app/archive-toast'
import { AgentCreature } from '@/components/orb/Creature'
import { automationHref } from '@overlay/app-core/automations'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  AGENT_DRAFT_PREVIEW_EVENT,
  type AgentDirectoryChangedEventDetail,
  type AgentDraftPreviewEventDetail,
  type AgentDraftPreviewPatch,
} from '@/shared/workspace/sidebar-events'
import {
  agentsForCreatorScope,
  getAgentOpenedAt,
  getLastOpenedAgentId,
  rememberAgentOpened,
  sortAgentsByRecency,
} from '@/shared/agents/last-agent-by-workspace'
import {
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatCreated,
  isPlaceholderChatTitle,
  mergeChatTitle,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import {
  arrayOrEmpty,
  agentHref,
  agentThreadHref,
  type AgentsPanelView,
} from './sidebar-nav'
import { AgentThreadRows } from './AppSidebarAgentThreads'

type AgentBundleMap = Record<string, WorkspaceAgentBundle | 'loading' | 'error'>

function bundleThreadTitle(bundle: AgentBundleMap[string] | undefined, conversationId: string): string {
  if (!bundle || bundle === 'loading' || bundle === 'error') return 'Thread'
  return bundle.threads.find((thread) => thread.conversationId === conversationId)?.title || 'Thread'
}

function useAgentBundles(workspaceId: string | null) {
  const [bundles, setBundles] = useState<AgentBundleMap>({})
  const bundleRequests = useRef(new Map<string, symbol>())
  const threadTitleOverrides = useRef(new Map<string, string>())

  const loadBundle = useCallback(async (agentId: string) => {
    if (!workspaceId) return
    const request = Symbol(agentId)
    bundleRequests.current.set(agentId, request)
    setBundles((current) => {
      const existing = current[agentId]
      return existing && typeof existing === 'object'
        ? current
        : { ...current, [agentId]: 'loading' }
    })
    try {
      const bundle = await overlayAppClient.agents.bundle(workspaceId, agentId)
      if (bundleRequests.current.get(agentId) !== request) return
      setBundles((current) => {
        const previous = current[agentId]
        const previousThreads = previous && typeof previous === 'object'
          ? new Map(previous.threads.map((thread) => [thread.conversationId, thread.title] as const))
          : new Map<string, string>()
        return {
          ...current,
          [agentId]: {
            ...bundle,
            threads: bundle.threads.map((thread) => {
              const titleBeforeFetch = threadTitleOverrides.current.get(thread.conversationId)
                ?? previousThreads.get(thread.conversationId)
                ?? thread.title
              return {
                ...thread,
                title: mergeChatTitle(titleBeforeFetch, thread.title),
              }
            }),
          },
        }
      })
    } catch {
      if (bundleRequests.current.get(agentId) !== request) return
      setBundles((current) => ({ ...current, [agentId]: 'error' }))
    }
  }, [workspaceId])

  // A first-message rename applies the generated title to the thread row it
  // belongs to without refetching the whole bundle.
  useEffect(() => {
    const onTitleUpdated = (event: Event) => {
      const { chatId, title } = (event as CustomEvent<ChatTitleUpdatedDetail>).detail ?? {}
      if (!chatId || !title) return
      if (!isPlaceholderChatTitle(title)) threadTitleOverrides.current.set(chatId, title)
      else threadTitleOverrides.current.delete(chatId)
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
              thread.conversationId === chatId
                ? { ...thread, title }
                : thread),
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
  // Fetch the URL agent's bundle once it is known absent. Reloading when the
  // bundle is already present re-triggers on every setBundles and loops
  // forever — directory-change events handle refreshes instead.
  useEffect(() => {
    if (!activeAgentId || activeAgentId in bundles) return
    void loadBundle(activeAgentId)
  }, [activeAgentId, bundles, loadBundle])

  const toggleExpanded = useCallback((agentId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
    const state = bundles[agentId]
    if (state === undefined || state === 'error') void loadBundle(agentId)
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
      const response = await overlayAppClient.agents.list(workspaceId)
      setAgents(arrayOrEmpty<WorkspaceAgentDirectoryItem>(response.agents))
      setViewerPrincipalId(response.viewerPrincipalId ?? null)
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

  return { agents, viewerPrincipalId, draftPreviews, loading }
}

function useAgentActions({
  workspaceId,
  baseHref,
  buildWorkspaceHref,
  view,
  onNavigate,
  bundles,
  setBundles,
  loadBundle,
  activeAgentId,
  activeConversationId,
  sortedAgents,
}: {
  workspaceId: string | null
  baseHref: string
  buildWorkspaceHref: ReturnType<typeof useWorkspaceHref>
  view: AgentsPanelView
  onNavigate?: () => void
  bundles: AgentBundleMap
  setBundles: Dispatch<SetStateAction<AgentBundleMap>>
  loadBundle: (agentId: string) => Promise<void>
  activeAgentId: string | null
  activeConversationId: string | null
  sortedAgents: WorkspaceAgentDirectoryItem[]
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
      const href = agentThreadHref(baseHref, agent.id, thread.conversationId, view)
      if (navigation === 'replace') router.replace(href)
      else router.push(href)
      if (navigation === 'push') onNavigate?.()
    } finally {
      setOpeningAgentId(null)
    }
  }, [baseHref, onNavigate, openingAgentId, router, view, workspaceId])

  const openThread = useCallback((
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    rememberAgentOpened(workspaceId, agent.id)
    router.push(agentThreadHref(baseHref, agent.id, conversationId, view))
    onNavigate?.()
  }, [baseHref, onNavigate, router, view, workspaceId])

  const openAutomation = useCallback((automationId: string) => {
    const href = automationHref({ _id: automationId })
    router.push(buildWorkspaceHref(workspaceId, href, view))
    onNavigate?.()
  }, [buildWorkspaceHref, onNavigate, router, view, workspaceId])

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
      // A collapsed row may still have a bundle request in flight. Refresh after
      // the mutation; only the newest request may publish the resulting tree.
      await loadBundle(agent.id)
      router.push(agentThreadHref(baseHref, agent.id, thread.conversationId, view))
      onNavigate?.()
    } finally {
      setCreatingThreadFor(null)
    }
  }, [baseHref, creatingThreadFor, loadBundle, onNavigate, router, setBundles, view, workspaceId])

  const archiveThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
    archived: boolean,
  ) => {
    if (!workspaceId) return
    try {
      // Only this thread is archived: the agent stays where it is, and the thread lands in Settings → Archived.
      await overlayAppClient.agents.setThreadArchived(workspaceId, agent.id, conversationId, archived)
      const archivedTitle = bundleThreadTitle(bundles[agent.id], conversationId)
      // An archived thread leaves the agent's list; a restored one comes back with the next load.
      void loadBundle(agent.id)
      if (archived) {
        announceArchived({
          name: archivedTitle,
          undo: async () => {
            await overlayAppClient.agents.setThreadArchived(workspaceId, agent.id, conversationId, false)
          },
          onUndone: () => void loadBundle(agent.id),
        })
        // Archiving the thread being viewed moves on to the agent's next active thread (a fresh one if none is left).
        if (activeConversationId === conversationId) {
          try {
            await openAgent(agent, 'replace')
          } catch {
            setOpenError(`Could not open ${agent.name}. Check your connection and retry.`)
          }
        }
      }
    } catch {
      void loadBundle(agent.id)
    }
  }, [activeConversationId, bundles, loadBundle, openAgent, workspaceId])

  const deleteThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    if (!workspaceId) return
    try {
      await overlayAppClient.agents.deleteThread(workspaceId, agent.id, conversationId)
      setBundles((current) => {
        const existing = current[agent.id]
        if (existing === 'loading' || existing === 'error' || !existing) return current
        let threads = existing.threads.filter((thread) => thread.conversationId !== conversationId)
        // When the main thread goes away the oldest survivor becomes main.
        const active = threads.filter((thread) => !thread.archivedAt)
        if (active.length && !active.some((thread) => thread.isMain)) {
          const oldest = active.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
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
            .filter((thread) => thread.conversationId !== conversationId && !thread.archivedAt)
            .sort((a, b) => a.createdAt - b.createdAt)[0]
          : undefined
        router.push(
          next
            ? agentThreadHref(baseHref, agent.id, next.conversationId, view)
            : agentHref(baseHref, agent.id, view),
        )
      }
    } catch {
      void loadBundle(agent.id)
    }
  }, [activeConversationId, baseHref, bundles, loadBundle, router, setBundles, view, workspaceId])

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
    openAutomation,
    createThread,
    archiveThread,
    deleteThread,
    retryOpen,
  }
}

function AgentListRow({
  agent,
  isExpanded,
  isActive,
  anyOpening,
  isOpening,
  bundle,
  activeConversationId,
  creatingThread,
  onToggleExpanded,
  onOpenAgent,
  onOpenThread,
  onOpenAutomation,
  onCreateThread,
  onArchiveThread,
  onDeleteThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  isExpanded: boolean
  isActive: boolean
  anyOpening: boolean
  isOpening: boolean
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  creatingThread: boolean
  onToggleExpanded: (agentId: string) => void
  onOpenAgent: (agent: WorkspaceAgentDirectoryItem) => void
  onOpenThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string) => void
  onOpenAutomation: (automationId: string) => void
  onCreateThread: (agent: WorkspaceAgentDirectoryItem) => void
  onArchiveThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean) => void
  onDeleteThread: (agent: WorkspaceAgentDirectoryItem, conversationId: string) => void
}) {
  return (
    <SidebarMenuItem>
      <div className="group/agent-row relative">
        <SidebarMenuButton
          isActive={isActive}
          disabled={anyOpening}
          // Reserve both actions on touch too; they are always visible below md.
          className="h-[38px] text-sm font-normal data-[active=true]:font-normal group-has-data-[sidebar=menu-action]/menu-item:pr-14"
          onClick={() => {
            if (!isExpanded) onToggleExpanded(agent.id)
            onOpenAgent(agent)
          }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            {isOpening
              ? <Loader2 size={16} className="animate-spin" />
              : <AgentCreature isDefault={agent.isDefault} agent={agent} size={24} />}
          </span>
          <span className="truncate">{agent.name}</span>
        </SidebarMenuButton>
        <SidebarMenuAction
          aria-label={`New thread with ${agent.name}`}
          title="New thread"
          disabled={creatingThread}
          className="right-7 top-[9px]"
          onClick={(event) => {
            event.stopPropagation()
            if (!isExpanded) onToggleExpanded(agent.id)
            onCreateThread(agent)
          }}
        >
          {creatingThread ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        </SidebarMenuAction>
        <SidebarMenuAction
          className="top-[9px]"
          aria-label={isExpanded ? `Collapse ${agent.name}` : `Expand ${agent.name}`}
          aria-expanded={isExpanded}
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded(agent.id)
          }}
        >
          <ChevronRight className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden />
        </SidebarMenuAction>
      </div>
      {isExpanded ? (
        <AgentThreadRows
          agent={agent}
          bundle={bundle}
          activeConversationId={activeConversationId}
          onOpenThread={onOpenThread}
          onOpenAutomation={onOpenAutomation}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
        />
      ) : null}
    </SidebarMenuItem>
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeAgentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null
  const activeConversationId = searchParams?.get('id') ?? null
  // Member count is independent of the creator-relative Personal/Workspace views.
  const solo = useIsSoloWorkspace()
  const buildWorkspaceHref = useWorkspaceHref()
  const scopedBaseHref = buildWorkspaceHref(workspaceId, baseHref, view)

  const { bundles, setBundles, loadBundle } = useAgentBundles(workspaceId)
  const { expanded, toggleExpanded } = useExpandedAgents({ activeAgentId, bundles, loadBundle })
  const {
    agents,
    viewerPrincipalId,
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

  // Live agents split into Personal (created by me) and Workspace (the rest). Archived agents and threads live in
  // Settings → Archived, not here.
  const tabAgents = useMemo(
    () => agentsForCreatorScope(
      previewedAgents.filter((agent) => !agent.archivedAt),
      viewerPrincipalId,
      view,
    ),
    [previewedAgents, view, viewerPrincipalId],
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
    openAutomation,
    createThread,
    archiveThread,
    deleteThread,
    retryOpen,
  } = useAgentActions({
    workspaceId,
    baseHref: scopedBaseHref,
    buildWorkspaceHref,
    view,
    onNavigate,
    bundles,
    setBundles,
    loadBundle,
    activeAgentId,
    activeConversationId,
    sortedAgents,
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

  // Thread links arrive with a missing or foreign scope (bare `?agent=`
  // deep links, legacy `?view=dms` URLs). The Personal/Workspace bucket is
  // viewer-relative anyway — the same link can belong under different tabs
  // for the creator vs a teammate — so rewrite the URL to the tab that
  // actually contains the open agent. An explicit agents view is a
  // deliberate tab choice and stays untouched.
  useEffect(() => {
    if (loading || !activeAgentId || !searchParams || viewerPrincipalId == null) return
    // `?view=` is how the tab was spelled before scopes.
    const viewParam = searchParams.get('scope') ?? searchParams.get('view')
    const active = agents.find((agent) => agent.id === activeAgentId)
    if (!active || active.archivedAt) return
    const correctView: AgentsPanelView = active.createdByPrincipalId === viewerPrincipalId
        ? 'personal'
        : 'workspace'
    const pathScope = readWorkspacePathScope(pathname)
    if (pathScope === correctView || (!pathScope && viewParam === correctView)) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('view')
    params.delete('scope')
    const route = buildWorkspaceHref(workspaceId, pathname, correctView)
    router.replace(`${route}${params.size ? `?${params.toString()}` : ''}`)
  }, [loading, activeAgentId, agents, viewerPrincipalId, searchParams, router, pathname, buildWorkspaceHref, workspaceId])

  return (
    <SidebarMenu>
      {loading ? (
        // Placeholders as tall as the rows they replace, so the list does not jump when the agents arrive.
        [0, 1, 2].map((index) => (
          <SidebarMenuItem key={index}><SidebarMenuSkeleton index={index} /></SidebarMenuItem>
        ))
      ) : sortedAgents.length ? (
        sortedAgents.map((agent) => {
          const isExpanded = expanded.has(agent.id)
          return (
            <AgentListRow
              key={agent.id}
              agent={agent}
              isExpanded={isExpanded}
              isActive={activeAgentId === agent.id && !activeConversationId}
              anyOpening={Boolean(openingAgentId)}
              isOpening={openingAgentId === agent.id}
              bundle={bundles[agent.id] ?? 'loading'}
              activeConversationId={activeConversationId}
              creatingThread={creatingThreadFor === agent.id}
              onToggleExpanded={toggleExpanded}
              onOpenAgent={(target) => void openAgentById(target)}
              onOpenThread={openThread}
              onOpenAutomation={openAutomation}
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
        <SidebarMenuItem>
          <p className="px-2.5 py-2 text-xs text-(--muted-light)">
            {solo ? 'No agents yet' : view === 'personal' ? 'No personal agents yet' : 'No workspace agents yet'}
          </p>
        </SidebarMenuItem>
      )}
      {openError ? (
        <SidebarMenuItem>
          <div className="px-2.5 py-2">
            <p role="alert" className="text-xs leading-4 text-red-500">{openError}</p>
            <Button variant="outline" size="sm" className="mt-1.5"
              type="button"
              onClick={retryOpen}
            >
              Retry
            </Button>
          </div>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  )
}
