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
import { beginNavigationIntent } from '@/shared/app/navigation-intent'
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
import { AgentThreadActivityProvider, useAgentActivityMap, useAgentThreadActivity } from './sidebar/AgentThreadActivityProvider'
import { AgentActivitySummary } from './sidebar/ThreadActivityIndicator'
import { hasThreadActivity } from '@/shared/agents/thread-activity'
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
  const agentIdsKey = JSON.stringify(agentIds)
  const queries = useMemo(() => {
    const ids: string[] = JSON.parse(agentIdsKey)
    return Object.fromEntries(workspaceId
      ? ids.map((agentId) => [agentId, { query: api.agents.threads.bundle, args: { workspaceId, agentId } }])
      : [])
  }, [agentIdsKey, workspaceId])
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
  const createAgentThread = useMutation(api.agents.threads.create)
  const setAgentThreadArchived = useMutation(api.agents.threads.setArchived)
  const [openError, setOpenError] = useState<string | null>(null)
  const [creatingThreadFor, setCreatingThreadFor] = useState<string | null>(null)

  useEffect(() => {
    setOpenError(null)
  }, [workspaceId])

  const openAgent = useCallback((
    agent: WorkspaceAgentDirectoryItem,
    navigation: 'push' | 'replace' = 'push',
    /** A thread just archived: the live list may not reflect it yet, so never open it. */
    skipConversationId?: string,
  ) => {
      if (!workspaceId) return
      // The destination already resolves its main thread and owns cancellation/retry.
      const live = bundles[agent.id]
      const thread = (live && typeof live === 'object'
        ? live.threads.find((row) => !row.archivedAt && row.conversationId !== skipConversationId)
        : undefined)
      rememberAgentOpened(workspaceId, agent.id)
      setOpenError(null)
      if (thread) dispatchChatCreated({
        chat: {
          _id: thread.conversationId,
          title: thread.title,
          lastModified: Date.now(),
          conversationType: 'dm',
        },
      })
      const href = thread
        ? agentThreadHref(baseHref, agent.id, thread.conversationId, view)
        : agentHref(baseHref, agent.id, view)
      beginNavigationIntent(href)
      if (navigation === 'replace') router.replace(href)
      else router.push(href)
      if (navigation === 'push') onNavigate?.()
  }, [baseHref, bundles, onNavigate, router, view, workspaceId])

  const openThread = useCallback((
    agent: WorkspaceAgentDirectoryItem,
    conversationId: string,
  ) => {
    const href = agentThreadHref(baseHref, agent.id, conversationId, view)
    beginNavigationIntent(href)
    rememberAgentOpened(workspaceId, agent.id)
    router.push(href)
    onNavigate?.()
  }, [baseHref, onNavigate, router, view, workspaceId])

  const openAutomation = useCallback((automationId: string) => {
    const href = automationHref({ _id: automationId })
    beginNavigationIntent(buildWorkspaceHref(workspaceId, href, view))
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
    openingAgentId: null,
    openError,
    creatingThreadFor,
    openAgentById,
    openThread,
    openAutomation,
    createThread,
    archiveThread,
    retryOpen,
  }
}

function AgentListRow({
  agent,
  pinned,
  ownerLabel,
  isExpanded,
  activityOnly = false,
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
}: {
  agent: WorkspaceAgentDirectoryItem
  pinned: boolean
  ownerLabel: string
  isExpanded: boolean
  activityOnly?: boolean
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
          activityOnly={activityOnly}
          activeConversationId={activeConversationId}
          onOpenThread={onOpenThread}
          onOpenAutomation={onOpenAutomation}
          onArchiveThread={onArchiveThread}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

function ActivityAgentRow({ agentId, activityOnly, children }: { agentId: string; activityOnly: boolean; children: React.ReactNode }) {
  const activity = useAgentThreadActivity(agentId)
  if (activityOnly && !activity?.some((item) => hasThreadActivity(item.status))) return null
  return <>{children}</>
}

function AgentActivityEmptyState({ agentIds }: { agentIds: string[] }) {
  const activity = useAgentActivityMap()
  if (agentIds.some((id) => activity[id] === undefined)) return null
  if (agentIds.some((id) => activity[id].some((item) => hasThreadActivity(item.status)))) return null
  return <SidebarMenuItem><p className="px-2.5 py-2 text-xs text-(--muted-light)">No activity yet</p></SidebarMenuItem>
}

export function AgentsInlinePanel({
  workspaceId,
  baseHref = '/app/agents',
  view = 'personal',
  onNavigate,
  activityOnly = false,
}: {
  workspaceId: string | null
  baseHref?: string
  view?: AgentsPanelView
  onNavigate?: () => void
  activityOnly?: boolean
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
  const [activityCollapsed, setActivityCollapsed] = useState<Set<string>>(new Set())
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
  const expandedIds = useMemo(() => activityOnly ? activityAgentIds.filter((id) => !activityCollapsed.has(id)) : [...expanded], [activityOnly, activityAgentIds, activityCollapsed, expanded])
  const { bundles } = useAgentBundles(workspaceId, expandedIds)
  function toggleAgent(agentId: string) {
    if (!activityOnly) { toggleExpanded(agentId); return }
    setActivityCollapsed((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  const {
    openingAgentId,
    openError,
    creatingThreadFor,
    openAgentById,
    openThread,
    openAutomation,
    createThread,
    archiveThread,
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
          const isExpanded = activityOnly ? !activityCollapsed.has(agent.id) : expanded.has(agent.id)
          return (
            <ActivityAgentRow key={agent.id} agentId={agent.id} activityOnly={activityOnly}>
            <AgentListRow
              key={agent.id}
              agent={agent}
              activityOnly={activityOnly}
              pinned={isPinnedChief(agent, viewerPrincipalId)}
              ownerLabel={agent.agentRole === 'workspace_chief' ? `${workspaceName} · Workspace` : `${agent.createdByDisplayName || 'Member'}${agent.createdByPrincipalId === viewerPrincipalId ? ' · You' : ''}`}
              isExpanded={isExpanded}
              isActive={activeAgentId === agent.id && !activeConversationId}
              anyOpening={Boolean(openingAgentId)}
              isOpening={openingAgentId === agent.id}
              bundle={bundles[agent.id] ?? 'loading'}
              activeConversationId={activeConversationId}
              creatingThread={creatingThreadFor === agent.id}
              onToggleExpanded={toggleAgent}
              onOpenAgent={(target) => void openAgentById(target)}
              onOpenThread={openThread}
              onOpenAutomation={openAutomation}
              onCreateThread={(target) => void createThread(target)}
              onArchiveThread={(target, conversationId, archived) => {
                void archiveThread(target, conversationId, archived)
              }}
            />
            </ActivityAgentRow>
          )
        })
      ) : (
        <SidebarMenuItem>
          <p className="px-2.5 py-2 text-xs text-(--muted-light)">
            {activityOnly ? 'No activity yet' : solo ? 'No agents yet' : view === 'personal' ? 'No personal agents yet' : 'No workspace agents yet'}
          </p>
        </SidebarMenuItem>
      )}
      {activityOnly && sortedAgents.length ? <AgentActivityEmptyState agentIds={activityAgentIds} /> : null}
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
