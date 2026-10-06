'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
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
import { ArchivedScopeList, type ArchivedScopeItem } from '@/components/layout/ArchivedScopeList'
import { withPanelScope } from '@/shared/workspaces/panel-scope'
import { SidebarResourceList } from '@overlay/ui/primitives'

import { arrayOrEmpty } from './sidebar-nav'
const nextSidebarMutation = createKnowledgeMutationPublisher(
  `web-sidebar:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

async function loadArchivedFiles(): Promise<ArchivedScopeItem[]> {
  const [fileRows, noteRows] = await Promise.all([
    overlayAppClient.files.get<FileTreeEntry[]>({ limit: 100, summary: true, view: 'archived' }),
    overlayAppClient.notes.get<NoteDoc[]>({ limit: 100, view: 'archived' }),
  ])
  const files = arrayOrEmpty<FileTreeEntry>(fileRows)
  const seen = new Set(files.map((file) => file._id))
  const notes = arrayOrEmpty<NoteDoc>(noteRows).map(noteDocToKnowledgeFile).filter((note) => !seen.has(note._id))
  return [...files, ...notes]
    // A folder's contents are archived with it; list only the top of each archived subtree.
    .filter((file, _index, all) => !file.parentId || !all.some((other) => other._id === file.parentId))
    .map((file) => {
      const scoped = file as FileTreeEntry & { archivedFromScope?: 'personal' | 'workspace'; scope?: 'personal' | 'workspace' }
      const params = new URLSearchParams(file.type === 'folder' ? { folder: file._id } : { [fileTreeRouteView(file) === 'note' ? 'id' : 'file']: file._id })
      params.set('scope', 'archived')
      const base = file.type !== 'folder' && fileTreeRouteView(file) === 'note' ? '/app/notes' : '/app/files'
      return {
        id: file._id,
        name: file.name,
        from: scoped.archivedFromScope ?? scoped.scope ?? 'personal',
        href: `${base}?${params}`,
      }
    })
}

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
  const scope = usePanelScope()
  const listView = usePanelListView()

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
      router.push(`/app/files?${withPanelScope(new URLSearchParams({ folder: file._id }), scope)}`)
      onNavigate?.()
      return
    }
    if (fileTreeRouteView(file) === 'note') {
      router.push(`/app/notes?${withPanelScope(new URLSearchParams({ id: file._id }), scope)}`)
    } else {
      router.push(`/app/files?${withPanelScope(new URLSearchParams({ file: file._id }), scope)}`)
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

  // Archived is one flat list of everything archived, each tagged with where it came from.
  if (scope === 'archived') {
    return (
      <ArchivedScopeList
        resource="files"
        emptyLabel="Nothing archived"
        onOpen={onNavigate}
        load={loadArchivedFiles}
        onRestored={() => window.dispatchEvent(new Event(KNOWLEDGE_RECONCILE_EVENT))}
      />
    )
  }

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






export interface InlineNavItem {
  id: string
  label: string
  icon?: LucideIcon
  locked?: boolean
  /** Items with an href render as links so they support open-in-new-tab. */
  href?: string
  badgeCount?: number
  /** Rows shown indented beneath this one while it is `expanded`. */
  children?: ReadonlyArray<InlineNavItem>
  expanded?: boolean
}

export function InlineNavChildren({
  id,
  items,
  activeId,
  activeChildId,
  pendingId,
  onSelect,
  className = 'mt-1 space-y-0.5',
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
  /** Container override — the default indents children under a nav row. */
  className?: string
}) {
  function renderRow(item: InlineNavItem, active: boolean, nested: boolean) {
    const itemClass = `flex ${nested ? 'h-8' : 'h-9'} w-full items-center gap-2.5 rounded-md px-3 ${nested ? 'text-[13px]' : 'text-sm'} transition-colors ${
      item.locked
        ? 'cursor-default text-[var(--muted-light)]'
        : active
          ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
          : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
    }`
    const content = (
      <>
        {pendingId === item.id ? (
          <Loader2 size={nested ? 14 : 15} className="shrink-0 animate-spin" aria-label={`Loading ${item.label}`} />
        ) : item.icon ? <item.icon size={nested ? 14 : 15} className="shrink-0" aria-hidden /> : null}
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
        {item.expanded && item.children?.length ? (
          <ChevronRight size={13} className="shrink-0 rotate-90 text-[var(--muted-light)]" aria-hidden />
        ) : null}
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
        aria-expanded={item.children?.length ? Boolean(item.expanded) : undefined}
        onClick={() => {
          if (!item.locked) onSelect(item.id)
        }}
        className={itemClass}
      >
        {content}
      </button>
    )
  }

  return (
    <div id={id} className={className}>
      {items.map((item) => (
        <div key={item.id}>
          {renderRow(item, activeId === item.id, false)}
          {item.expanded && item.children?.length ? (
            // Not indented: what an expansion reveals lines up with the row that opened it (see interface-design.md).
            <div className="space-y-0.5 pb-1 pt-0.5">
              {item.children.map((child) => renderRow(child, activeChildId === child.id, true))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
