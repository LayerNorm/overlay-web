'use client'

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Folder,
  Hash,
  Loader2,
  Mail,
  MessageSquare,
  Package,
  Plug,
  Server,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react'
import type { KnowledgeBase } from '@overlay/app-core'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  KnowledgeMutationConsumer,
  PROJECT_META_UPDATED_EVENT,
  canMoveProjectFile,
  filterProjectFilesForSearch,
  projectFilesExcludingNotes,
  projectHubHref,
  projectItemHref,
  projectNotesFromFiles,
  projectRouteViewForFile,
  renameProjectInList,
  noteDocToKnowledgeFile,
  normalizeKnowledgeSurfaceNode,
  removeKnowledgeFileSubtrees,
  createKnowledgeMutationPublisher,
  isKnowledgeEntityMutation,
  sortProjectsByName,
  type ProjectChatSummary,
  type ProjectFileSummary,
  type ProjectResourceItems,
  type ProjectSummary,
  type NoteDoc,
} from '@overlay/app-core'
import { FilesInlineTree, ProjectsInlineTree } from '@overlay/modules-react/projects'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'
import { SidebarResourceList } from '@overlay/ui/primitives'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  type AgentDirectoryChangedEventDetail,
} from '@/shared/workspace/sidebar-events'

type Project = ProjectSummary
type ProjectChat = ProjectChatSummary
type ProjectFile = ProjectFileSummary

const arrayOrEmpty = <T,>(value: unknown): T[] => Array.isArray(value) ? value : []
const INITIAL_SIDEBAR_LIST_LIMIT = 24
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
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const activeFileId = searchParams?.get('file') ?? null
  const activeNoteId = searchParams?.get('id') ?? null
  const activeCanonicalFileId = activeFileId ?? activeNoteId

  const fetchItems = useCallback(async (signal?: AbortSignal): Promise<ProjectFile[]> => {
    const [fileRows, noteRows] = await Promise.all([
      overlayAppClient.files.get<ProjectFile[]>({ limit: 100, summary: true }, { signal }),
      overlayAppClient.notes.get<NoteDoc[]>({ limit: 100 }, { signal }),
    ])
    const files = arrayOrEmpty<ProjectFile>(fileRows)
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

  function openFile(file: ProjectFile) {
    if (file.type === 'folder') {
      router.push(`/app/files?folder=${encodeURIComponent(file._id)}`)
      onNavigate?.()
      return
    }
    if (projectRouteViewForFile(file) === 'note') {
      router.push(`/app/notes?id=${encodeURIComponent(file._id)}`)
    } else {
      router.push(`/app/files?file=${encodeURIComponent(file._id)}`)
    }
    onNavigate?.()
  }

  async function moveFile(fileId: string, parentId: string | null) {
    if (!canMoveProjectFile(files, fileId, parentId)) return
    const res = await overlayAppClient.files.updateResponse({ fileId, parentId })
    if (res.ok) {
      setFiles((current) => current.map((file) => file._id === fileId ? { ...file, parentId } : file))
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
        detail: nextSidebarMutation({ entity: 'file', id: fileId, operation: 'moved' }),
      }))
    }
  }

  const q = searchQuery.trim()
  const filteredFiles = useMemo(() => filterProjectFilesForSearch(files, q), [files, q])

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

export function ProjectsInlinePanel({
  refreshKey,
  archived = false,
  onNavigate,
}: {
  refreshKey: number
  /** When true, list archived projects instead of active ones. */
  archived?: boolean
  onNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [itemsByProject, setItemsByProject] = useState<Record<string, ProjectResourceItems>>({})
  const [itemsLoading, setItemsLoading] = useState<Set<string>>(new Set())
  const activeProjectId = searchParams?.get('projectId') ?? null

  const loadProjects = useCallback(async () => {
    try {
      const page = await overlayAppClient.projects.getPage<Project>({
        limit: INITIAL_SIDEBAR_LIST_LIMIT,
        archived: archived || undefined,
      })
      setProjects(arrayOrEmpty<Project>(page.data))
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch { setProjects([]) } finally { setLoading(false) }
  }, [archived])

  useEffect(() => {
    setLoading(true)
    void loadProjects()
  }, [loadProjects, refreshKey])

  useWorkspaceChanged(loadProjects)

  async function loadMoreProjects() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await overlayAppClient.projects.getPage<Project>({
        cursor: nextCursor,
        limit: INITIAL_SIDEBAR_LIST_LIMIT,
        archived: archived || undefined,
      })
      setProjects((current) => {
        const byId = new Map(current.map((project) => [project._id, project]))
        for (const project of arrayOrEmpty<Project>(page.data)) byId.set(project._id, project)
        return [...byId.values()]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }

  const loadProjectItems = useCallback(async (projectId: string) => {
    setItemsLoading((prev) => new Set(prev).add(projectId))
    try {
      const [chats, notes, files] = await Promise.all([
        overlayAppClient.conversations.get<ProjectChat[]>({ projectId, limit: 100 }),
        overlayAppClient.files.get<ProjectFile[]>({ kind: 'note', projectId, limit: 100 }),
        overlayAppClient.files.get<ProjectFile[]>({ projectId, limit: 100 }),
      ])
      const noteRows = Array.isArray(notes) ? projectNotesFromFiles(notes) : []
      const fileRows = Array.isArray(files) ? projectFilesExcludingNotes(files) : []
      setItemsByProject((prev) => ({ ...prev, [projectId]: { chats: arrayOrEmpty<ProjectChat>(chats), notes: noteRows, files: fileRows } }))
    } finally {
      setItemsLoading((prev) => {
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
    }
  }, [])

  function toggleProject(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
    if (!itemsByProject[projectId] && !itemsLoading.has(projectId)) {
      void loadProjectItems(projectId)
    }
  }

  function navigateItem(project: Project, view: 'chat' | 'note' | 'file', id: string) {
    router.push(projectItemHref({ project, view, id }))
    onNavigate?.()
  }

  function openProjectHub(project: Project) {
    router.push(projectHubHref(project))
    onNavigate?.()
  }

  async function deleteProject(projectId: string, event: MouseEvent) {
    event.stopPropagation()
    await overlayAppClient.projects.deleteResponse({ projectId })
    setProjects((prev) => prev.filter((project) => project._id !== projectId))
    setItemsByProject((prev) => {
      const next = { ...prev }
      delete next[projectId]
      return next
    })
  }

  function handleProjectRenamed(projectId: string, name: string) {
    setProjects((prev) => renameProjectInList(prev, projectId, name))
  }

  async function renameProject(project: Project, name: string): Promise<string | null> {
    try {
      const res = await overlayAppClient.projects.updateResponse({ projectId: project._id, name })
      if (!res.ok) return null
      const data = (await res.json().catch(() => ({}))) as { project?: Project }
      const finalName = data.project?.name?.trim() || name
      handleProjectRenamed(project._id, finalName)
      window.dispatchEvent(
        new CustomEvent(PROJECT_META_UPDATED_EVENT, { detail: { projectId: project._id, name: finalName } }),
      )
      return finalName
    } catch {
      return null
    }
  }

  async function deleteItem(type: 'chat' | 'note', id: string, event: MouseEvent) {
    event.stopPropagation()
    if (type === 'chat') {
      await overlayAppClient.conversations.deleteResponse({ conversationId: id })
    } else {
      await overlayAppClient.notes.deleteResponse({ noteId: id })
    }
    setItemsByProject((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        const entry = next[key]
        next[key] = {
          chats: type === 'chat' ? entry.chats.filter((chat) => chat._id !== id) : entry.chats,
          notes: type === 'note' ? entry.notes.filter((note) => note._id !== id) : entry.notes,
          files: entry.files,
        }
      }
      return next
    })
  }

  const rootProjects = useMemo(() => {
    const loadedIds = new Set(projects.map((project) => project._id))
    return sortProjectsByName(
      projects.filter((project) => !project.parentId || !loadedIds.has(project.parentId)),
    )
  }, [projects])

  return (
    <SidebarResourceList>
      <ProjectsInlineTree
        projects={projects}
        rootProjects={rootProjects}
        loading={loading}
        loadingContent={<SidebarListSkeleton rows={5} />}
        expanded={expanded}
        activeProjectId={activeProjectId}
        items={itemsByProject}
        itemsLoading={itemsLoading}
        onToggle={toggleProject}
        onOpenProject={openProjectHub}
        onNavigateItem={navigateItem}
        onDeleteProject={deleteProject}
        onDeleteItem={deleteItem}
        onRenameProject={renameProject}
      />
      {hasMore ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMoreProjects()}
          className="h-7 w-full rounded-md px-2.5 text-left text-xs text-[var(--muted-light)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      ) : null}
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
  const [loading, setLoading] = useState(true)
  const activeAgentId = searchParams?.get('agent') ?? null

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
    const refreshAgents = (event: Event) => {
      const changedWorkspaceId = (event as CustomEvent<AgentDirectoryChangedEventDetail>).detail?.workspaceId
      if (!changedWorkspaceId || changedWorkspaceId === workspaceId) void loadAgents(false)
    }
    window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
    return () => window.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refreshAgents)
  }, [loadAgents, workspaceId])

  return (
    <SidebarResourceList>
      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--muted-light)]">
          <Loader2 size={13} className="animate-spin" /> Loading agents...
        </div>
      ) : agents.length ? (
        agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`${resourceRowClass} ${activeAgentId === agent.id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            onClick={() => {
              router.push(`${baseHref}?agent=${encodeURIComponent(agent.id)}`)
              onNavigate?.()
            }}
          >
            <Bot size={13} className="shrink-0" />
            <span className="truncate">{agent.name}</span>
          </button>
        ))
      ) : (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No agents yet</p>
      )}
    </SidebarResourceList>
  )
}

export function KnowledgeInlinePanel({
  baseHref = '/app/knowledge',
  onNavigate,
}: {
  baseHref?: string
  onNavigate?: () => void
}) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const activeKnowledgeBaseId = searchParams?.get('knowledgeBase') ?? null

  const loadKnowledgeBases = useCallback(async () => {
    setLoading(true)
    try {
      const response = await overlayAppClient.knowledgeBases.list()
      setKnowledgeBases(arrayOrEmpty<KnowledgeBase>(response.knowledgeBases))
    } catch {
      setKnowledgeBases([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadKnowledgeBases() }, [loadKnowledgeBases])
  useWorkspaceChanged(loadKnowledgeBases)

  return (
    <SidebarResourceList>
      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--muted-light)]">
          <Loader2 size={13} className="animate-spin" /> Loading knowledge...
        </div>
      ) : knowledgeBases.length ? (
        knowledgeBases.map((knowledgeBase) => (
          <Link
            key={knowledgeBase.id}
            href={`${baseHref}/${encodeURIComponent(knowledgeBase.id)}`}
            onClick={onNavigate}
            className={`${resourceRowClass} ${activeKnowledgeBaseId === knowledgeBase.id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
          >
            {knowledgeBase.kind === 'personal' ? <Brain size={13} className="shrink-0" /> : <BookOpen size={13} className="shrink-0" />}
            <span className="truncate">{knowledgeBase.title}</span>
          </Link>
        ))
      ) : (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No knowledge bases yet</p>
      )}
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

export const projectsInlineItems = [
  { id: 'all', label: 'All', icon: Folder },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const

export const agentsInlineItems = [
  { id: 'personal', label: 'Personal', icon: UserRound },
  { id: 'workspace', label: 'Workspace', icon: UsersRound },
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
