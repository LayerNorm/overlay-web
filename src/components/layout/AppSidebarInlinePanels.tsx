'use client'

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import {
  FILES_CHANGED_EVENT,
  NOTES_CHANGED_EVENT,
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
  sortProjectsByName,
  type ProjectChatSummary,
  type ProjectFileSummary,
  type ProjectResourceItems,
  type ProjectSummary,
  type NoteDoc,
} from '@overlay/app-core'
import { FilesInlineTree, ProjectsInlineTree } from '@overlay/modules-react/projects'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SidebarResourceList } from '@overlay/ui/primitives'

type Project = ProjectSummary
type ProjectChat = ProjectChatSummary
type ProjectFile = ProjectFileSummary

const arrayOrEmpty = <T,>(value: unknown): T[] => Array.isArray(value) ? value : []
const INITIAL_SIDEBAR_LIST_LIMIT = 24

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

  const loadItems = useCallback(async () => {
    try {
      const [fileRows, noteRows] = await Promise.all([
        overlayAppClient.files.get<ProjectFile[]>({ limit: 100, summary: true }),
        overlayAppClient.notes.get<NoteDoc[]>({ limit: 100 }),
      ])
      const files = arrayOrEmpty<ProjectFile>(fileRows)
      const fileIds = new Set(files.map((file) => file._id))
      const notes = arrayOrEmpty<NoteDoc>(noteRows)
        .map(noteDocToKnowledgeFile)
        .filter((note) => !fileIds.has(note._id))
      setFiles([...files, ...notes])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    function handleFilesChanged() {
      void loadItems()
    }
    window.addEventListener(NOTES_CHANGED_EVENT, handleFilesChanged)
    window.addEventListener(FILES_CHANGED_EVENT, handleFilesChanged)
    return () => {
      window.removeEventListener(NOTES_CHANGED_EVENT, handleFilesChanged)
      window.removeEventListener(FILES_CHANGED_EVENT, handleFilesChanged)
    }
  }, [loadItems])

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
      await loadItems()
      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
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
  onNavigate,
}: {
  refreshKey: number
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
      })
      setProjects(arrayOrEmpty<Project>(page.data))
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch { setProjects([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadProjects()
  }, [loadProjects, refreshKey])

  async function loadMoreProjects() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await overlayAppClient.projects.getPage<Project>({
        cursor: nextCursor,
        limit: INITIAL_SIDEBAR_LIST_LIMIT,
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
      await overlayAppClient.files.deleteResponse({ fileId: id })
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

export const toolsInlineItems = [
  { id: 'connectors', label: 'Connectors' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcps', label: 'MCPs' },
  { id: 'apps', label: 'Apps', locked: true },
] as const

export function InlineNavChildren({
  items,
  activeId,
  onSelect,
}: {
  items: ReadonlyArray<{ id: string; label: string; locked?: boolean }>
  activeId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="mt-1 space-y-0.5 pl-7">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            if (!item.locked) onSelect(item.id)
          }}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
            item.locked
              ? 'cursor-default text-[var(--muted-light)]'
              : activeId === item.id
                ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
          }`}
        >
          <span className="flex-1 text-left">{item.label}</span>
          {item.locked ? <span className="text-[10px] text-[var(--muted-light)]">Soon</span> : null}
        </button>
      ))}
    </div>
  )
}
