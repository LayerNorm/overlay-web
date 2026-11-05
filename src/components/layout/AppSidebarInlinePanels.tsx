'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConvexAuth, useMutation, useQuery_experimental } from 'convex/react'
import { ChevronRight, Loader2 } from 'lucide-react'
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
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { withPanelScope } from '@/shared/workspaces/panel-scope'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarResourceList,
  toast,
} from '@overlay/ui/primitives'
import { cn } from '@overlay/ui'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { optimisticMove } from '@/shared/knowledge/native-file-metadata-optimistic'

import { arrayOrEmpty } from './sidebar-nav'
import type { InlineNavItem } from '@overlay/shell-react'
export type { InlineNavItem } from '@overlay/shell-react'

const nextSidebarMutation = createKnowledgeMutationPublisher(
  `web-sidebar:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

export function FilesInlinePanel(props: {
  searchQuery?: string
  onNavigate?: () => void
}) {
  const authConfiguration = useConvexAuthConfiguration()
  const { user } = useAuth()
  const workspace = useWorkspace()
  const scope = usePanelScope()
  const workspaceId = workspace.switchingWorkspaceId ? null : workspace.activeWorkspaceId
  if (!authConfiguration.nativeAuthConfigured) return <LegacyFilesInlinePanel {...props} />
  if (!authConfiguration.hasConvexClient) {
    return (
      <SidebarResourceList>
        <p className="px-3 py-2 text-xs text-(--muted-light)" role="status">
          Native file metadata is unavailable.
        </p>
      </SidebarResourceList>
    )
  }
  return (
    <NativeFilesInlinePanel
      key={`${user?.id ?? 'anonymous'}:${workspaceId ?? 'unavailable'}:${scope}`}
      {...props}
      workspaceId={workspaceId}
      workspaceReady={workspace.status === 'ready' && !workspace.switchingWorkspaceId}
      listView={scope}
    />
  )
}

function LegacyFilesInlinePanel({
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
  const scope = usePanelScope()
  const listView = usePanelListView()
  const buildWorkspaceHref = useWorkspaceHref()

  const fetchItems = useCallback(async (signal?: AbortSignal): Promise<FileTreeEntry[]> => {
    const [fileRows, noteRows] = await Promise.all([
      overlayAppClient.files.get<FileTreeEntry[]>({ limit: 100, summary: true, view: listView }, { signal }),
      overlayAppClient.notes.get<NoteDoc[]>({ limit: 100, view: listView }, { signal }),
    ])
    const files = arrayOrEmpty<FileTreeEntry>(fileRows)
    const fileIds = new Set(files.map((file) => file._id))
    const notes = arrayOrEmpty<NoteDoc>(noteRows)
      .map(noteDocToKnowledgeFile)
      .filter((note) => !fileIds.has(note._id))
    return [...files, ...notes]
  }, [listView])

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
      router.push(buildWorkspaceHref(null, `/app/files?${withPanelScope(new URLSearchParams({ folder: file._id }), scope)}`, scope))
      onNavigate?.()
      return
    }
    if (fileTreeRouteView(file) === 'note') {
      router.push(buildWorkspaceHref(null, `/app/notes?${withPanelScope(new URLSearchParams({ id: file._id }), scope)}`, scope))
    } else {
      router.push(buildWorkspaceHref(null, `/app/files?${withPanelScope(new URLSearchParams({ file: file._id }), scope)}`, scope))
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






function NativeFilesInlinePanel({
  searchQuery = '',
  onNavigate,
  workspaceId,
  workspaceReady,
  listView,
}: {
  searchQuery?: string
  onNavigate?: () => void
  workspaceId: string | null
  workspaceReady: boolean
  listView: PanelScope
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [legacyNotes, setLegacyNotes] = useState<FileTreeEntry[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const activeFileId = searchParams?.get('file') ?? null
  const activeNoteId = searchParams?.get('id') ?? null
  const activeCanonicalFileId = activeFileId ?? activeNoteId
  const buildWorkspaceHref = useWorkspaceHref()
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const listArgs = canQuery
    ? { workspaceId: workspaceId!, view: listView === 'workspace' ? 'workspace' as const : 'personal' as const }
    : 'skip' as const
  const fileQuery = useQuery_experimental({ query: api.files.nativeMetadata.list, args: listArgs })
  const fileResult = fileQuery.status === 'success'
    ? fileQuery.data
    : fileQuery.status === 'error' ? fileQuery.error : undefined
  const moveMutation = useMutation(api.files.nativeMetadata.move).withOptimisticUpdate((store, args) => {
    optimisticMove(store, args)
  })

  const loadNotes = useCallback(async (signal?: AbortSignal) => {
    setNotesLoading(true)
    try {
      const rows = await overlayAppClient.notes.get<NoteDoc[]>({ limit: 100, view: listView }, { signal })
      setLegacyNotes(arrayOrEmpty<NoteDoc>(rows).map(noteDocToKnowledgeFile))
    } catch {
      if (!signal?.aborted) setLegacyNotes([])
    } finally {
      if (!signal?.aborted) setNotesLoading(false)
    }
  }, [listView])
  const reloadNotes = useCallback(() => { void loadNotes() }, [loadNotes])

  useEffect(() => {
    const controller = new AbortController()
    void loadNotes(controller.signal)
    return () => controller.abort()
  }, [loadNotes])
  useWorkspaceChanged(reloadNotes)
  useEffect(() => {
    const reloadLegacyNotes = (event?: Event) => {
      const mutation = event ? (event as CustomEvent<unknown>).detail : null
      if (!mutation || (isKnowledgeEntityMutation(mutation) && mutation.entity === 'note')) {
        void loadNotes()
      }
    }
    window.addEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, reloadLegacyNotes)
    window.addEventListener(KNOWLEDGE_RECONCILE_EVENT, reloadLegacyNotes)
    window.addEventListener('online', reloadLegacyNotes)
    return () => {
      window.removeEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, reloadLegacyNotes)
      window.removeEventListener(KNOWLEDGE_RECONCILE_EVENT, reloadLegacyNotes)
      window.removeEventListener('online', reloadLegacyNotes)
    }
  }, [loadNotes])

  const nativeFiles = useMemo(() => fileResult && !(fileResult instanceof Error)
    ? fileResult.nodes as unknown as FileTreeEntry[]
    : [], [fileResult])
  const nativeIds = useMemo(() => new Set(nativeFiles.map((file) => file._id)), [nativeFiles])
  const files = useMemo(
    () => [...nativeFiles, ...legacyNotes.filter((note) => !nativeIds.has(note._id))],
    [legacyNotes, nativeFiles, nativeIds],
  )
  const queryError = fileResult instanceof Error
    ? fileResult.message
    : workspaceReady && !workspaceId ? 'Workspace is unavailable.'
      : !authLoading && !isAuthenticated ? 'Native file metadata is unavailable.' : null

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
      router.push(buildWorkspaceHref(null, `/app/files?${withPanelScope(new URLSearchParams({ folder: file._id }), listView)}`, listView))
      onNavigate?.()
      return
    }
    if (fileTreeRouteView(file) === 'note') {
      router.push(buildWorkspaceHref(null, `/app/notes?${withPanelScope(new URLSearchParams({ id: file._id }), listView)}`, listView))
    } else {
      router.push(buildWorkspaceHref(null, `/app/files?${withPanelScope(new URLSearchParams({ file: file._id }), listView)}`, listView))
    }
    onNavigate?.()
  }

  async function moveFile(fileId: string, parentId: string | null) {
    if (!canMoveFileInTree(files, fileId, parentId)) return
    const nativeFile = nativeFiles.find((file) => file._id === fileId)
    if (nativeFile && workspaceId) {
      try {
        await moveMutation({
          workspaceId,
          fileId: fileId as Id<'files'>,
          expectedUpdatedAt: nativeFile.updatedAt,
          parentId: parentId as Id<'files'> | null,
        })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not move file.')
      }
      return
    }
    const response = await overlayAppClient.files.updateResponse({ fileId, parentId })
    if (response.ok) {
      setLegacyNotes((current) => current.map((file) => file._id === fileId ? { ...file, parentId } : file))
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
        detail: nextSidebarMutation({ entity: 'file', id: fileId, operation: 'moved' }),
      }))
    }
  }

  const query = searchQuery.trim()
  const filteredFiles = useMemo(() => filterFilesForTreeSearch(files, query), [files, query])

  return (
    <SidebarResourceList>
      {queryError ? <p className="px-3 py-2 text-xs text-red-400" role="alert">{queryError}</p> : null}
      <FilesInlineTree
        files={filteredFiles}
        loading={!workspaceReady || authLoading || (canQuery && fileResult === undefined) || notesLoading}
        loadingContent={<SidebarListSkeleton rows={7} />}
        emptyLabel={query ? 'No results' : 'No files yet'}
        activeFileId={activeCanonicalFileId}
        expanded={expanded}
        onToggle={toggleFile}
        onOpen={openFile}
        onMove={moveFile}
      />
    </SidebarResourceList>
  )
}

export function InlineNavChildren({
  id,
  items,
  activeId,
  activeChildId,
  pendingId,
  onSelect,
  className = 'mt-1',
}: {
  id?: string
  items: ReadonlyArray<InlineNavItem>
  /** Empty when the section is open but not the current route, so an expanded
   * dropdown never implies a selection the person did not make. */
  activeId: string
  /** The selected row among an expanded item's `children`. */
  activeChildId?: string
  pendingId?: string | null
  /** Also fires for href items on link click, so callers can close chrome. */
  onSelect: (id: string) => void
  /** Container override — spacing/padding around the whole nav list. */
  className?: string
}) {
  function renderRow(item: InlineNavItem, active: boolean, nested: boolean) {
    // Top-level rows are the large menu button; revealed rows are the compact sub button inside the guide-line
    // list, so no row class ever sets a left offset — the list's line carries the indent.
    const rowClass = cn(
      nested ? undefined : 'gap-2.5 px-3',
      item.locked ? 'cursor-default text-(--muted-light) hover:bg-transparent hover:text-(--muted-light)' : undefined,
    )
    const content = (
      <>
        {pendingId === item.id ? (
          <Loader2 size={nested ? 13 : 15} className="shrink-0 animate-spin" aria-label={`Loading ${item.label}`} />
        ) : item.icon ? <item.icon size={nested ? 13 : 15} className="shrink-0" aria-hidden /> : null}
        <span className="flex-1 text-left">{item.label}</span>
        {item.badgeCount ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-(--border) text-[9px] font-medium leading-none text-(--foreground)"
            aria-label={`${item.badgeCount} unread`}
          >
            {item.badgeCount > 9 ? '9+' : item.badgeCount}
          </span>
        ) : null}
        {item.locked ? <span className="text-[10px] text-(--muted-light)">Soon</span> : null}
        {item.expanded && item.children?.length ? (
          <ChevronRight size={13} className="shrink-0 rotate-90 text-(--muted-light)" aria-hidden />
        ) : null}
      </>
    )
    if (item.href && !item.locked) {
      const link = (
        <Link
          href={item.href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            onSelect(item.id)
          }}
        >
          {content}
        </Link>
      )
      return nested ? (
        <SidebarMenuSubButton asChild isActive={active} className={rowClass}>
          {link}
        </SidebarMenuSubButton>
      ) : (
        <SidebarMenuButton asChild size="lg" isActive={active} className={rowClass}>
          {link}
        </SidebarMenuButton>
      )
    }
    if (nested) {
      return (
        <SidebarMenuSubButton
          isActive={active && !item.locked}
          onClick={() => {
            if (!item.locked) onSelect(item.id)
          }}
          className={rowClass}
        >
          {content}
        </SidebarMenuSubButton>
      )
    }
    return (
      <SidebarMenuButton
        size="lg"
        isActive={active && !item.locked}
        aria-expanded={item.children?.length ? Boolean(item.expanded) : undefined}
        onClick={() => {
          if (!item.locked) onSelect(item.id)
        }}
        className={rowClass}
      >
        {content}
      </SidebarMenuButton>
    )
  }

  return (
    <SidebarMenu id={id} className={className}>
      {items.map((item) => (
        <SidebarMenuItem key={item.id}>
          {renderRow(item, activeId === item.id, false)}
          {item.expanded && item.children?.length ? (
            // What an expansion reveals nests under the same guide line as an agent's threads (`SidebarMenuSub`).
            <SidebarMenuSub>
              {item.children.map((child) => (
                <SidebarMenuSubItem key={child.id}>{renderRow(child, activeChildId === child.id, true)}</SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          ) : null}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}
