'use client'

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConvex, useConvexAuth, useMutation, useQueries } from 'convex/react'
import { Archive, RotateCcw, User, Users } from 'lucide-react'
import { Button, toast } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import {
  KnowledgeBulkActionsContext,
  KnowledgeCreateAccessContext,
  KnowledgeRowActionsContext,
  SharedKnowledgeSurface,
  type ControlledKnowledgeFileSnapshot,
  type KnowledgeBulkSelection,
  type SharedKnowledgeFilePort,
  type SharedKnowledgeMemoryPort,
  type SharedKnowledgeRouteState,
} from '@overlay/modules-react/knowledge'
import {
  normalizeKnowledgeSurfaceNode,
  type KnowledgeFileNode,
  type KnowledgeSurfaceAdapters,
} from '@overlay/app-core'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useScopeItemActions, type ScopedItem } from '@/hooks/use-scope-item-actions'
import { announceArchived, refreshAfterRestore } from '@/shared/app/archive-toast'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { optimisticMove, optimisticRename, optimisticScopeChange } from './native-file-metadata-optimistic'

type ScopeAction = 'move' | 'archive' | 'restore'

const ROW_ACTION_CLASS =
  'shrink-0 rounded-sm p-1 transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50'
const BULK_ACTION_CLASS =
  'inline-flex h-8 min-h-8 items-center gap-1.5 rounded-md border border-(--border) bg-(--surface-muted) px-2.5 py-0 text-xs leading-none text-(--foreground) transition-colors hover:bg-(--surface-subtle) disabled:cursor-not-allowed disabled:opacity-40'

type NativeActions = {
  run(id: string, action: ScopeAction, to?: PanelScope): Promise<void>
  restoreFresh(id: string): Promise<void>
}

const NativeActionsContext = createContext<NativeActions | null>(null)

function NativeFileRowActions({ node, onChanged }: { node: KnowledgeFileNode; onChanged(): void }) {
  const actions = useScopeItemActions('content', 'files')
  const native = useContext(NativeActionsContext)
  const [busy, setBusy] = useState(false)
  const options = actions.optionsFor(node as ScopedItem)
  if (!native || (!options.moveTo && !options.canArchive && !options.canRestore)) return null

  async function run(action: ScopeAction, to?: PanelScope) {
    setBusy(true)
    try {
      await native.run(node._id, action, to)
      onChanged()
      if (action === 'archive') {
        announceArchived({
          name: node.name,
          undo: () => native.restoreFresh(node._id),
          onUndone: () => refreshAfterRestore('files'),
        })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {options.moveTo ? (
        <Button variant="ghost" type="button" title={options.moveTo === 'workspace' ? 'Move to Workspace' : 'Move to Personal'}
          aria-label={options.moveTo === 'workspace' ? 'Move to Workspace' : 'Move to Personal'} disabled={busy}
          onClick={(event) => { event.stopPropagation(); void run('move', options.moveTo!) }}
          className={unstyledButton(`${ROW_ACTION_CLASS} text-(--muted-light)`)}>
          {options.moveTo === 'workspace' ? <Users size={12} /> : <User size={12} />}
        </Button>
      ) : null}
      {options.canArchive ? (
        <Button variant="ghost" type="button" title="Archive" aria-label="Archive" disabled={busy}
          onClick={(event) => { event.stopPropagation(); void run('archive') }}
          className={unstyledButton(`${ROW_ACTION_CLASS} text-(--muted-light)`)}>
          <Archive size={12} />
        </Button>
      ) : null}
      {options.canRestore ? (
        <Button variant="ghost" type="button" title="Restore" aria-label="Restore" disabled={busy}
          onClick={(event) => { event.stopPropagation(); void run('restore') }}
          className={unstyledButton(`${ROW_ACTION_CLASS} text-(--muted-light)`)}>
          <RotateCcw size={12} />
        </Button>
      ) : null}
    </>
  )
}

function NativeFileBulkActions({ selection }: { selection: KnowledgeBulkSelection }) {
  const { nodes, afterChange } = selection
  const actions = useScopeItemActions('content', 'files')
  const native = useContext(NativeActionsContext)
  const [busy, setBusy] = useState(false)
  if (!native || nodes.length === 0) return null
  const options = nodes.map((node) => actions.optionsFor(node as ScopedItem))
  const moveTo = options.every((option) => option.moveTo && option.moveTo === options[0]?.moveTo)
    ? options[0]?.moveTo ?? null : null
  const canArchive = options.every((option) => option.canArchive)
  const canRestore = options.every((option) => option.canRestore)

  async function run(action: ScopeAction, to?: PanelScope) {
    setBusy(true)
    const results = await Promise.allSettled(nodes.map((node) => native.run(node._id, action, to)))
    const changed = nodes.filter((_, index) => results[index]?.status === 'fulfilled')
    const failures = nodes.length - changed.length
    setBusy(false)
    if (changed.length === nodes.length) afterChange()
    if (failures) toast.error(`${action === 'move' ? 'Moved' : action === 'archive' ? 'Archived' : 'Restored'} ${changed.length} of ${nodes.length} items. ${failures} could not be ${action === 'move' ? 'moved' : action === 'archive' ? 'archived' : 'restored'}.`)
    if (action === 'archive' && changed.length) {
      announceArchived({
        name: changed.length === 1 ? changed[0]!.name : `${changed.length} items`,
        ...(changed.length > 1 ? { summary: `Archived ${changed.length} items` } : {}),
        undo: async () => Promise.all(changed.map((node) => native.restoreFresh(node._id))).then(() => undefined),
        onUndone: () => refreshAfterRestore('files'),
      })
    }
  }

  return (
    <>
      {moveTo ? <Button variant="ghost" type="button" disabled={busy} onClick={() => void run('move', moveTo)}
        className={unstyledButton(BULK_ACTION_CLASS)}>
        {moveTo === 'workspace' ? <Users size={13} /> : <User size={13} />}
        {moveTo === 'workspace' ? 'Move to Workspace' : 'Move to Personal'} ({nodes.length})
      </Button> : null}
      {canArchive ? <Button variant="ghost" type="button" disabled={busy} onClick={() => void run('archive')}
        className={unstyledButton(BULK_ACTION_CLASS)}><Archive size={13} />Archive ({nodes.length})</Button> : null}
      {canRestore ? <Button variant="ghost" type="button" disabled={busy} onClick={() => void run('restore')}
        className={unstyledButton(BULK_ACTION_CLASS)}><RotateCcw size={13} />Restore ({nodes.length})</Button> : null}
    </>
  )
}

export function NativeKnowledgeBoundary({
  mode,
  initialMemories,
  route,
  queryPending,
  onUpdateQuery,
  headerTabs,
  adapters,
  memories,
  files: filePort,
  renderFileViewer,
  canAdd,
  workspaceId,
  workspaceReady,
  listView,
  hasConvexClient,
}: {
  mode: 'knowledge' | 'files'
  initialMemories?: Parameters<typeof SharedKnowledgeSurface>[0]['initialMemories']
  route: SharedKnowledgeRouteState
  queryPending: boolean
  onUpdateQuery(updates: Record<string, string | null | undefined>): void
  headerTabs?: ReactNode
  adapters: KnowledgeSurfaceAdapters
  memories: SharedKnowledgeMemoryPort
  files: SharedKnowledgeFilePort
  renderFileViewer(props: { file: KnowledgeFileNode; name: string; content: string; url?: string }): ReactNode
  canAdd: boolean
  workspaceId: string | null
  workspaceReady: boolean
  listView: PanelScope
  hasConvexClient: boolean
}) {
  if (!hasConvexClient) {
    return (
      <KnowledgeCreateAccessContext.Provider value={false}>
        <SharedKnowledgeSurface
          mode={mode}
          route={route}
          queryPending={queryPending}
          onUpdateQuery={onUpdateQuery}
          headerTabs={headerTabs}
          adapters={adapters}
          memories={memories}
          files={filePort}
          renderFileViewer={renderFileViewer}
          initialMemories={initialMemories}
          controlledFileSnapshot={{
            nodes: [], loading: false, error: 'Native file metadata is unavailable.',
            truncated: false, detailFileId: route.file, detail: null, detailLoading: false,
            detailError: route.file ? 'Native file metadata is unavailable.' : null,
          }}
        />
      </KnowledgeCreateAccessContext.Provider>
    )
  }
  return (
    <NativeKnowledgeConnected
      mode={mode}
      initialMemories={initialMemories}
      route={route}
      queryPending={queryPending}
      onUpdateQuery={onUpdateQuery}
      headerTabs={headerTabs}
      adapters={adapters}
      memories={memories}
      filePort={filePort}
      renderFileViewer={renderFileViewer}
      canAdd={canAdd}
      workspaceId={workspaceId}
      workspaceReady={workspaceReady}
      listView={listView}
    />
  )
}

function NativeKnowledgeConnected({
  mode,
  initialMemories,
  route,
  queryPending,
  onUpdateQuery,
  headerTabs,
  adapters,
  memories,
  filePort,
  renderFileViewer,
  canAdd,
  workspaceId,
  workspaceReady,
  listView,
}: {
  mode: 'knowledge' | 'files'
  initialMemories?: Parameters<typeof SharedKnowledgeSurface>[0]['initialMemories']
  route: SharedKnowledgeRouteState
  queryPending: boolean
  onUpdateQuery(updates: Record<string, string | null | undefined>): void
  headerTabs?: ReactNode
  adapters: KnowledgeSurfaceAdapters
  memories: SharedKnowledgeMemoryPort
  filePort: SharedKnowledgeFilePort
  renderFileViewer(props: { file: KnowledgeFileNode; name: string; content: string; url?: string }): ReactNode
  canAdd: boolean
  workspaceId: string | null
  workspaceReady: boolean
  listView: PanelScope
}) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const convex = useConvex()
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const listArgs = canQuery
    ? { workspaceId: workspaceId!, view: listView === 'workspace' ? 'workspace' as const : 'personal' as const }
    : 'skip' as const
  const detailArgs = canQuery && route.file
    ? { workspaceId: workspaceId!, fileId: route.file as Id<'files'> }
    : 'skip' as const
  const queryResults = useQueries({
    list: { query: api.files.nativeMetadata.list, args: listArgs },
    detail: { query: api.files.nativeMetadata.detail, args: detailArgs },
  })
  const renameMutation = useMutation(api.files.nativeMetadata.rename).withOptimisticUpdate((store, args) => {
    optimisticRename(store, args)
  })
  const moveMutation = useMutation(api.files.nativeMetadata.move).withOptimisticUpdate((store, args) => {
    optimisticMove(store, args)
  })
  const scopeMutation = useMutation(api.files.nativeMetadata.changeScope).withOptimisticUpdate((store, args) => {
    optimisticScopeChange(store, args)
  })

  const listResult = queryResults.list
  const detailResult = queryResults.detail
  const nativeNodes = listResult && !(listResult instanceof Error)
    ? listResult.nodes.map((node) => normalizeKnowledgeSurfaceNode(node))
    : []
  const listError = listResult instanceof Error
    ? listResult.message
    : workspaceReady && !workspaceId ? 'Workspace is unavailable.'
      : !authLoading && !isAuthenticated ? 'Native file metadata is unavailable.' : null
  const detailNode = detailResult && !(detailResult instanceof Error)
    ? normalizeKnowledgeSurfaceNode(detailResult)
    : null
  const nativeNodesRef = useRef(nativeNodes)
  const detailNodeRef = useRef(detailNode)
  nativeNodesRef.current = nativeNodes
  detailNodeRef.current = detailNode
  const detailError = detailResult instanceof Error
    ? detailResult.message
    : route.file && workspaceReady && !workspaceId ? 'Workspace is unavailable.'
      : route.file && !authLoading && !isAuthenticated ? 'Native file metadata is unavailable.' : null
  const snapshot: ControlledKnowledgeFileSnapshot = {
    nodes: nativeNodes,
    loading: !canQuery || listResult === undefined,
    error: listError,
    truncated: listResult && !(listResult instanceof Error) ? listResult.truncated : false,
    detailFileId: route.file,
    detail: detailNode,
    detailLoading: Boolean(route.file && (!canQuery || detailResult === undefined)),
    detailError,
  }

  const nativeActions = useMemo<NativeActions>(() => ({
    async run(id, action, to) {
      if (!workspaceId) throw new Error('Native file metadata is unavailable.')
      const fileId = id as Id<'files'>
      const file = nativeNodes.find((node) => node._id === id)
        ?? (detailNode?._id === id ? detailNode : null)
      if (!file) throw new Error('File is unavailable.')
      if (action === 'move') {
        await scopeMutation({
          workspaceId,
          fileId,
          expectedUpdatedAt: file.updatedAt,
          action: 'move',
          to,
        })
      } else {
        await scopeMutation({
          workspaceId,
          fileId,
          expectedUpdatedAt: file.updatedAt,
          action,
        })
      }
    },
    async restoreFresh(id) {
      if (!workspaceId) throw new Error('Native file metadata is unavailable.')
      const fileId = id as Id<'files'>
      const latest = await convex.query(api.files.nativeMetadata.detail, { workspaceId, fileId })
      if (!latest) throw new Error('File is unavailable.')
      await scopeMutation({
        workspaceId,
        fileId,
        expectedUpdatedAt: latest.updatedAt,
        action: 'restore',
      })
    },
  }), [convex, detailNode, nativeNodes, scopeMutation, workspaceId])

  const nativeAdapters = useMemo<KnowledgeSurfaceAdapters>(() => ({
    ...adapters,
    repository: {
      ...adapters.repository,
      async rename(input) {
        if (!workspaceId || !input.expectedRevision) throw new Error('Native file metadata is unavailable.')
        const result = await renameMutation({
          workspaceId,
          fileId: input.id as Id<'files'>,
          expectedUpdatedAt: Number(input.expectedRevision),
          name: input.name,
        })
        return normalizeKnowledgeSurfaceNode(result)
      },
      async move(input) {
        if (!workspaceId) throw new Error('Native file metadata is unavailable.')
        const file = nativeNodesRef.current.find((node) => node._id === input.id)
          ?? (detailNodeRef.current?._id === input.id ? detailNodeRef.current : null)
        if (!file) throw new Error('File is unavailable.')
        const result = await moveMutation({
          workspaceId,
          fileId: input.id as Id<'files'>,
          expectedUpdatedAt: file.updatedAt,
          parentId: input.parentId as Id<'files'> | null,
        })
        return normalizeKnowledgeSurfaceNode(result)
      },
    },
  }), [adapters, moveMutation, renameMutation, workspaceId])

  const nativeFilePort = useMemo<SharedKnowledgeFilePort>(() => ({
    ...filePort,
    entityChanged() {},
  }), [filePort])

  const renderRowActions = (node: KnowledgeFileNode) => (
    <NativeFileRowActions
      node={node}
      onChanged={() => { if (route.file === node._id) onUpdateQuery({ file: null }) }}
    />
  )
  const renderBulkActions = (selection: KnowledgeBulkSelection) => (
    <NativeFileBulkActions selection={selection} />
  )

  return (
    <NativeActionsContext.Provider value={nativeActions}>
      <KnowledgeCreateAccessContext.Provider value={canAdd && canQuery && !listError}>
        <KnowledgeRowActionsContext.Provider value={renderRowActions}>
          <KnowledgeBulkActionsContext.Provider value={renderBulkActions}>
            <SharedKnowledgeSurface
              mode={mode}
              initialMemories={initialMemories}
              route={route}
              queryPending={queryPending}
              onUpdateQuery={onUpdateQuery}
              headerTabs={headerTabs}
              adapters={nativeAdapters}
              memories={memories}
              files={nativeFilePort}
              renderFileViewer={renderFileViewer}
              controlledFileSnapshot={snapshot}
            />
          </KnowledgeBulkActionsContext.Provider>
        </KnowledgeRowActionsContext.Provider>
      </KnowledgeCreateAccessContext.Provider>
    </NativeActionsContext.Provider>
  )
}
