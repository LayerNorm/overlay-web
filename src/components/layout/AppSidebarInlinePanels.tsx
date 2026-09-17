'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Bell,
  Hash,
  Loader2,
  Mail,
  MessageSquare,
  Package,
  Plug,
  Server,
  Sparkles,
} from 'lucide-react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  KnowledgeMutationConsumer,
  canMoveFileInTree,
  filterFilesForTreeSearch,
  fileTreeRouteView,
  noteDocToKnowledgeFile,
  normalizeKnowledgeSurfaceNode,
  removeKnowledgeFileSubtrees,
  createKnowledgeMutationPublisher,
  isKnowledgeEntityMutation,
  type FileTreeEntry,
  type NoteDoc,
} from '@overlay/app-core'
import { FilesInlineTree } from '@overlay/modules-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { SidebarResourceList } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  AGENT_DRAFT_PREVIEW_EVENT,
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

const arrayOrEmpty = <T,>(value: unknown): T[] => Array.isArray(value) ? value : []
const nextSidebarMutation = createKnowledgeMutationPublisher(
  `web-sidebar:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

export function FilesInlinePanel({
  searchQuery = '',
  onNavigate,
}: {
  searchQuery?: string
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [files, setFiles] = useState<FileTreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const activeFileId = searchParams?.get('file') ?? null
  const activeNoteId = searchParams?.get('id') ?? null
  const activeCanonicalFileId = activeFileId ?? activeNoteId

  const fetchItems = useCallback(async (signal?: AbortSignal): Promise<FileTreeEntry[]> => {
    const [fileRows, noteRows] = await Promise.all([
      overlayAppClient.files.get<FileTreeEntry[]>({ limit: 100, summary: true }, { signal }),
      overlayAppClient.notes.get<NoteDoc[]>({ limit: 100 }, { signal }),
    ])
    const files = arrayOrEmpty<FileTreeEntry>(fileRows)
    const fileIds = new Set(files.map((file) => file._id))
    const notes = arrayOrEmpty<NoteDoc>(noteRows)
      .map(noteDocToKnowledgeFile)
      .filter((note) => !fileIds.has(note._id))
    return [...files, ...notes]
  }, [])

  const loadItems = useCallback(async () => {
    try {
      setFiles(await fetchItems())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [fetchItems])

  useEffect(() => {
    setLoading(true)
    void loadItems()
  }, [loadItems])

  useWorkspaceChanged(loadItems)

  useEffect(() => {
    const consumer = new KnowledgeMutationConsumer({
      origin: 'web-sidebar-consumer',
      repository: {
        async list(signal) {
          return {
            nodes: (await fetchItems(signal)).map((file) => normalizeKnowledgeSurfaceNode({
              ...file,
              createdAt: file.updatedAt ?? 0,
            })),
          }
        },
        async get() { return null },
      },
      async loadNode(mutation, signal) {
        if (mutation.entity === 'note') {
          const note = await overlayAppClient.notes.get<NoteDoc>({ noteId: mutation.id }, { signal })
          return normalizeKnowledgeSurfaceNode(noteDocToKnowledgeFile(note))
        }
        const response = await overlayAppClient.files.getResponse({ fileId: mutation.id }, { signal })
        if (response.status === 404) return null
        if (!response.ok) throw new Error('Could not update sidebar file')
        return normalizeKnowledgeSurfaceNode(await response.json())
      },
      apply(event) {
        if (event.type === 'reset') {
          setFiles([...event.nodes])
        } else if (event.type === 'created' || event.type === 'updated') {
          setFiles((current) => current.some((file) => file._id === event.node.id)
            ? current.map((file) => file._id === event.node.id ? event.node : file)
            : [...current, event.node])
        } else if (event.type === 'deleted') {
          setFiles((current) => removeKnowledgeFileSubtrees(current, event.ids))
        }
      },
    })
    const handleMutation = (event: Event) => {
      const mutation = (event as CustomEvent<unknown>).detail
      if (isKnowledgeEntityMutation(mutation)) void consumer.handle(mutation).catch(() => undefined)
    }
    const handleReconcile = () => { void consumer.reconcile('explicit-refresh').catch(() => undefined) }
    const handleOnline = () => { void consumer.reconcile('reconnected').catch(() => undefined) }
    window.addEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
    window.addEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
    window.addEventListener('online', handleOnline)
    return () => {
      consumer.dispose()
      window.removeEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
      window.removeEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
      window.removeEventListener('online', handleOnline)
    }
  }, [fetchItems])

  function toggleFile(fileId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  function openFile(file: FileTreeEntry) {
    if (file.type === 'folder') {
      router.push(`/app/files?folder=${encodeURIComponent(file._id)}`)
      onNavigate?.()
      return
    }
    if (fileTreeRouteView(file) === 'note') {
      router.push(`/app/notes?id=${encodeURIComponent(file._id)}`)
    } else {
      router.push(`/app/files?file=${encodeURIComponent(file._id)}`)
    }
    onNavigate?.()
  }

  async function moveFile(fileId: string, parentId: string | null) {
    if (!canMoveFileInTree(files, fileId, parentId)) return
    const res = await overlayAppClient.files.updateResponse({ fileId, parentId })
    if (res.ok) {
      setFiles((current) => current.map((file) => file._id === fileId ? { ...file, parentId } : file))
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
        detail: nextSidebarMutation({ entity: 'file', id: fileId, operation: 'moved' }),
      }))
    }
  }

  const q = searchQuery.trim()
  const filteredFiles = useMemo(() => filterFilesForTreeSearch(files, q), [files, q])

  return (
    <SidebarResourceList>
      <FilesInlineTree
        files={filteredFiles}
        loading={loading}
        loadingContent={<SidebarListSkeleton rows={7} />}
        emptyLabel={q ? 'No results' : 'No files yet'}
        activeFileId={activeCanonicalFileId}
        expanded={expanded}
        onToggle={toggleFile}
        onOpen={openFile}
        onMove={moveFile}
      />
    </SidebarResourceList>
  )
}

const resourceRowClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export function AgentsInlinePanel({
  workspaceId,
  baseHref = '/app/agents',
  onNavigate,
}: {
  workspaceId: string | null
  baseHref?: string
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<WorkspaceAgentDirectoryItem[]>([])
  const [draftPreviews, setDraftPreviews] = useState<Record<string, AgentDraftPreviewPatch>>({})
  const [loading, setLoading] = useState(true)
  const [openingAgentId, setOpeningAgentId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const activeAgentId = searchParams?.get('agent') ?? searchParams?.get('agentId') ?? null

  // Unsaved editor drafts overlay the fetched directory so the row renames and
  // re-skins while the user types; the override clears on save/cancel/close.
  const previewedAgents = useMemo(
    () => agents.map((agent) => {
      const patch = draftPreviews[agent.id]
      return patch ? { ...agent, ...patch } : agent
    }),
    [agents, draftPreviews],
  )

  // Most recently used first; agents with no recorded use stay alphabetical.
  const sortedAgents = useMemo(
    () => sortAgentsByRecency(previewedAgents, getAgentOpenedAt(workspaceId)),
    [previewedAgents, workspaceId],
  )

  const loadAgents = useCallback(async (showLoading = true) => {
    if (!workspaceId) {
      setAgents([])
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    try {
      const response = await overlayAppClient.agents.list(workspaceId)
      setAgents(arrayOrEmpty<WorkspaceAgentDirectoryItem>(response.agents))
    } catch {
      setAgents([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void loadAgents() }, [loadAgents])

  useEffect(() => {
    setOpenError(null)
  }, [workspaceId])

  useEffect(() => {
    const refreshAgents = (event: Event) => {
      const changedWorkspaceId = (event as CustomEvent<AgentDirectoryChangedEventDetail>).detail?.workspaceId
      if (!changedWorkspaceId || changedWorkspaceId === workspaceId) void loadAgents(false)
    }
    window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
    return () => window.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
  }, [loadAgents, workspaceId])

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

  const openAgent = useCallback(async (
    agent: WorkspaceAgentDirectoryItem,
    navigation: 'push' | 'replace' = 'push',
  ) => {
    if (openingAgentId) return
    setOpeningAgentId(agent.id)
    try {
      if (!workspaceId) return
      const { directMessage } = await overlayAppClient.conversations.createWorkspaceDirectMessage(workspaceId, {
        principalIds: [agent.principalId],
      })
      rememberAgentOpened(workspaceId, agent.id)
      setOpenError(null)
      dispatchChatCreated({
        chat: {
          _id: directMessage.conversationId,
          title: directMessage.title,
          lastModified: Date.now(),
          conversationType: 'dm',
        },
      })
      const params = new URLSearchParams({
        agent: agent.id,
        view: 'dms',
        id: directMessage.conversationId,
      })
      const href = `${baseHref}?${params.toString()}`
      if (navigation === 'replace') router.replace(href)
      else router.push(href)
      if (navigation === 'push') onNavigate?.()
    } finally {
      setOpeningAgentId(null)
    }
  }, [baseHref, onNavigate, openingAgentId, router, workspaceId])

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
        sortedAgents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            disabled={Boolean(openingAgentId)}
            className={`${resourceRowClass} ${activeAgentId === agent.id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            onClick={() => void openAgentById(agent)}
          >
            {openingAgentId === agent.id
              ? <Loader2 size={13} className="shrink-0 animate-spin" />
              : <AgentCreature agent={agent} size={16} />}
            <span className="truncate">{agent.name}</span>
          </button>
        ))
      ) : (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No agents yet</p>
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

export const toolsInlineItems = [
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcps', label: 'MCPs', icon: Server },
  { id: 'apps', label: 'Apps', icon: Package, locked: true },
] as const

export const chatsInlineItems = [
  { id: 'personal', label: 'Personal', icon: MessageSquare },
  { id: 'dms', label: 'Direct Messages', icon: Mail },
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const

export interface InlineNavItem {
  id: string
  label: string
  icon?: LucideIcon
  locked?: boolean
  /** Items with an href render as links so they support open-in-new-tab. */
  href?: string
  badgeCount?: number
}

export function InlineNavChildren({
  id,
  items,
  activeId,
  pendingId,
  onSelect,
  className = 'mt-1 space-y-0.5 pl-7',
}: {
  id?: string
  items: ReadonlyArray<InlineNavItem>
  /** Empty when the section is open but not the current route, so an expanded
   * dropdown never implies a selection the person did not make. */
  activeId: string
  pendingId?: string | null
  /** Also fires for href items on link click, so callers can close chrome. */
  onSelect: (id: string) => void
  /** Container override — the default indents children under a nav row. */
  className?: string
}) {
  return (
    <div id={id} className={className}>
      {items.map((item) => {
        const itemClass = `flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
          item.locked
            ? 'cursor-default text-[var(--muted-light)]'
            : activeId === item.id
              ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
              : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
        }`
        const content = (
          <>
            {pendingId === item.id ? (
              <Loader2 size={15} className="shrink-0 animate-spin" aria-label={`Loading ${item.label}`} />
            ) : item.icon ? <item.icon size={15} className="shrink-0" aria-hidden /> : null}
            <span className="flex-1 text-left">{item.label}</span>
            {item.badgeCount ? (
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--border)] text-[9px] font-medium leading-none text-[var(--foreground)]"
                aria-label={`${item.badgeCount} unread`}
              >
                {item.badgeCount > 9 ? '9+' : item.badgeCount}
              </span>
            ) : null}
            {item.locked ? <span className="text-[10px] text-[var(--muted-light)]">Soon</span> : null}
          </>
        )
        if (item.href && !item.locked) {
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                onSelect(item.id)
              }}
              className={itemClass}
            >
              {content}
            </Link>
          )
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!item.locked) onSelect(item.id)
            }}
            className={itemClass}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
