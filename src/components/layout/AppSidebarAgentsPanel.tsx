'use client'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { readWorkspacePathScope } from '@/shared/workspaces/routing'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronRight,
  Loader2,
  Plus,
  Pin,
} from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, Button, toast } from '@overlay/ui/primitives'
import { announceArchived } from '@/shared/app/archive-toast'
import { AgentCreature } from '@/components/orb/Creature'
import { automationHref } from '@overlay/app-core/automations'
import {
  AGENT_DRAFT_PREVIEW_EVENT,
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
  agentHref,
  agentThreadHref,
  type AgentsPanelView,
} from './sidebar-nav'
import { AgentThreadRows } from './AppSidebarAgentThreads'
import { isChief, isPinnedChief, pinChiefs } from '@/shared/agents/chief-identity'
import { agentBelongsToCreatorScope } from '@/shared/agents/last-agent-by-workspace'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { useAgentExpansion } from './sidebar/useAgentExpansion'
import { AgentThreadActivityProvider, useAgentThreadActivity } from './sidebar/AgentThreadActivityProvider'
import { AgentActivitySummary } from './sidebar/ThreadActivityIndicator'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import { useMutation, useQueries } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type AgentBundleMap = Record<string, WorkspaceAgentBundle | 'loading' | 'error'>

function bundleThreadTitle(bundle: AgentBundleMap[string] | undefined, conversationId: string): string {
  if (!bundle || bundle === 'loading' || bundle === 'error') return 'Thread'
  return bundle.threads.find((thread) => thread.conversationId === conversationId)?.title || 'Thread'
}

/** Live thread lists for the agents whose rows are open. Each is its own Convex subscription. */
function useAgentBundles(workspaceId: string | null, agentIds: readonly string[]) {
  const queries = useMemo(() => Object.fromEntries(workspaceId
    ? agentIds.map((agentId) => [agentId, { query: api.agents.threads.bundle, args: { workspaceId, agentId } }])
    : []), [agentIds, workspaceId])
  const results = useQueries(queries)
  // A first-message rename names the thread before the saved title arrives.
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  useEffect(() => {
    const onTitleUpdated = (event: Event) => {
      const { chatId, title } = (event as CustomEvent<ChatTitleUpdatedDetail>).detail ?? {}
      if (!chatId || !title) return
      setTitleOverrides((current) => {
        const next = { ...current }
        if (!isPlaceholderChatTitle(title)) next[chatId] = title
        else delete next[chatId]
        return next
      })
    }
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
    return () => window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
  }, [])
  const bundles = useMemo<AgentBundleMap>(() => Object.fromEntries(Object.keys(queries).map((agentId) => {
    const result = results[agentId] as WorkspaceAgentBundle | null | undefined | Error
    if (result === undefined) return [agentId, 'loading']
    if (!result || result instanceof Error) return [agentId, 'error']
    return [agentId, {
      ...result,
      threads: result.threads.map((thread) => ({
        ...thread,
        title: mergeChatTitle(titleOverrides[thread.conversationId] ?? thread.title, thread.title),
      })),
    }]
  })), [queries, results, titleOverrides])
  return { bundles }
}

function useSidebarAgentDirectory(workspaceId: string | null) {
  const live = useAgentDirectory()
  const agents = live.agents ?? []
  const viewerPrincipalId = live.viewerPrincipalId
  const loading = live.status === 'loading'
  // Unsaved editor drafts, keyed by workspace so switching workspaces drops them.
  const [drafts, setDrafts] = useState<{ workspaceId: string | null; previews: Record<string, AgentDraftPreviewPatch> }>(
    { workspaceId, previews: {} },
  )
  const draftPreviews = drafts.workspaceId === workspaceId ? drafts.previews : {}

  useEffect(() => {
    const onDraftPreview = (event: Event) => {
      const detail = (event as CustomEvent<AgentDraftPreviewEventDetail>).detail
      if (!detail || detail.workspaceId !== workspaceId) return
      setDrafts((current) => {
        const next = { ...(current.workspaceId === workspaceId ? current.previews : {}) }
        if (detail.patch) next[detail.agentId] = detail.patch
        else delete next[detail.agentId]
        return { workspaceId, previews: next }
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
  activeAgentId: string | null
  activeConversationId: string | null
  sortedAgents: WorkspaceAgentDirectoryItem[]
}) {
  const router = useRouter()
  const resolveMainThread = useMutation(api.agents.threads.resolveMain)
  const createAgentThread = useMutation(api.agents.threads.create)
  const setAgentThreadArchived = useMutation(api.agents.threads.setArchived)
  const removeAgentThread = useMutation(api.agents.threads.remove)
  const [openingAgentId, setOpeningAgentId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [creatingThreadFor, setCreatingThreadFor] = useState<string | null>(null)

  useEffect(() => {
    setOpenError(null)
  }, [workspaceId])

  const openAgent = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    navigation: 'push' | 'replace' = 'push',
    /** A thread just archived: the live list may not reflect it yet, so never open it. */
    skipConversationId?: string,
  ) => {
    if (openingAgentId) return
    setOpeningAgentId(agent.id)
    try {
      if (!workspaceId) return
      // A live thread list opens instantly; otherwise resolve (or create) the main thread once.
      const live = bundles[agent.id]
      const thread = (live && typeof live === 'object'
        ? live.threads.find((row) => !row.archivedAt && row.conversationId !== skipConversationId)
        : undefined)
        ?? await resolveMainThread({ workspaceId, agentId: agent.id })
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
  }, [baseHref, bundles, onNavigate, openingAgentId, resolveMainThread, router, view, workspaceId])

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
      const thread = await createAgentThread({ workspaceId, agentId: agent.id })
      rememberAgentOpened(workspaceId, agent.id)
      router.push(agentThreadHref(baseHref, agent.id, thread.conversationId, view))
      onNavigate?.()
    } finally {
      setCreatingThreadFor(null)
    }
  }, [baseHref, createAgentThread, creatingThreadFor, onNavigate, router, view, workspaceId])

  const archiveThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
    archived: boolean,
  ) => {
    if (!workspaceId) return
    try {
      // Only this thread is archived: the agent stays where it is, and the thread lands in Settings → Archived.
      const archivedTitle = bundleThreadTitle(bundles[agent.id], conversationId)
      await setAgentThreadArchived({ workspaceId, agentId: agent.id, conversationId: conversationId as Id<'conversations'>, archived })
      if (archived) {
        announceArchived({
          name: archivedTitle,
          undo: async () => {
            await setAgentThreadArchived({ workspaceId, agentId: agent.id, conversationId: conversationId as Id<'conversations'>, archived: false })
          },
        })
        // Archiving the thread being viewed moves on to the agent's next active thread (a fresh one if none is left).
        if (activeConversationId === conversationId) {
          try {
            await openAgent(agent, 'replace', conversationId)
          } catch {
            setOpenError(`Could not open ${agent.name}. Check your connection and retry.`)
          }
        }
      }
    } catch {
      toast.error('Could not update this thread.')
    }
  }, [activeConversationId, bundles, openAgent, setAgentThreadArchived, workspaceId])

  const deleteThread = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    if (!workspaceId) return
    try {
      await removeAgentThread({ workspaceId, agentId: agent.id, conversationId: conversationId as Id<'conversations'> })
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
    } catch (error) {
      toast.error(error instanceof Error && error.message.includes('AGENT_LAST_THREAD')
        ? 'An agent must keep at least one thread.'
        : 'Could not delete this thread.')
    }
  }, [activeConversationId, baseHref, bundles, removeAgentThread, router, view, workspaceId])

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
  pinned,
  ownerLabel,
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
  pinned: boolean
  ownerLabel: string
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
  const activity = useAgentThreadActivity(agent.id)
  return (
    <SidebarMenuItem>
      <div className="group/agent-row relative">
        <SidebarMenuButton
          isActive={isActive}
          disabled={anyOpening}
          // Reserve both actions on touch too; they are always visible below md.
          className="h-12 text-sm font-normal data-[active=true]:font-normal group-has-data-[sidebar=menu-action]/menu-item:pr-14"
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
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5"><span className="truncate">{agent.name}</span>{pinned ? <Pin size={11} className="shrink-0 text-(--muted)" aria-label="Pinned chief of staff" /> : null}</span>
            <AgentActivitySummary activity={activity} fallback={isChief(agent) ? ownerLabel : undefined} />
          </span>
        </SidebarMenuButton>
        <SidebarMenuAction
          aria-label={`New thread with ${agent.name}`}
          title="New thread"
          disabled={creatingThread}
          className="right-7 top-[14px]"
          onClick={(event) => {
            event.stopPropagation()
            if (!isExpanded) onToggleExpanded(agent.id)
            onCreateThread(agent)
          }}
        >
          {creatingThread ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        </SidebarMenuAction>
        <SidebarMenuAction
          className="top-[14px]"
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
          activity={activity}
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
  const workspaceName = useOptionalWorkspace()?.activeWorkspace?.name ?? 'Workspace'
  const buildWorkspaceHref = useWorkspaceHref()
  const scopedBaseHref = buildWorkspaceHref(workspaceId, baseHref, view)

  const { expanded, toggle: toggleExpanded } = useAgentExpansion(activeAgentId)
  const expandedIds = useMemo(() => [...expanded], [expanded])
  const { bundles } = useAgentBundles(workspaceId, expandedIds)
  const {
    agents,
    viewerPrincipalId,
    draftPreviews,
    loading,
  } = useSidebarAgentDirectory(workspaceId)

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
    () => pinChiefs(sortAgentsByRecency(tabAgents, getAgentOpenedAt(workspaceId)), viewerPrincipalId),
    [tabAgents, workspaceId, viewerPrincipalId],
  )
  const activityAgentIds = useMemo(() => sortedAgents.map(agent => agent.id), [sortedAgents])

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
    const correctView: AgentsPanelView = agentBelongsToCreatorScope(active, viewerPrincipalId, 'personal')
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
    <AgentThreadActivityProvider workspaceId={workspaceId} agentIds={activityAgentIds}>
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
              pinned={isPinnedChief(agent, viewerPrincipalId)}
              ownerLabel={agent.agentRole === 'workspace_chief' ? `${workspaceName} · Workspace` : `${agent.createdByDisplayName || 'Member'}${agent.createdByPrincipalId === viewerPrincipalId ? ' · You' : ''}`}
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
    </AgentThreadActivityProvider>
  )
}
