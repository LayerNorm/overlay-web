'use client'

// Web host adapter: Next routing and browser transport stay at the platform
// boundary while presentation lives in @overlay/modules-react.
import { isEditableType } from '@/shared/files/file-viewer-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  createKnowledgeMutationPublisher,
  createManualMemoryRequest,
  type KnowledgeFileNode,
  type MemoryRow,
} from '@overlay/app-core'
import {
  KnowledgeBulkActionsContext,
  KnowledgeCreateAccessContext,
  KnowledgeRowActionsContext,
  SharedKnowledgeSurface,
  type SharedKnowledgeFilePort,
  type SharedKnowledgeMemoryPort,
  type KnowledgeBulkSelection,
  type SharedKnowledgeRouteState,
} from '@overlay/modules-react/knowledge'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useTransition } from 'react'
import { usePanelListView, usePanelScope } from '@/hooks/use-panel-scope'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { ScopeBulkActions } from '@/components/layout/ScopeBulkActions'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { newItemScope } from '@/shared/workspaces/panel-scope'
import { createWebKnowledgeSurfaceAdapters } from '../adapters/webKnowledgeSurfaceAdapters'
import { responseError, uploadWebFile } from './webKnowledgeFileUpload'

const nextKnowledgeMutation = createKnowledgeMutationPublisher(
  `web-knowledge:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

function publishKnowledgeMutation(
  entity: 'file' | 'note',
  id: string,
  operation: 'created' | 'updated' | 'moved' | 'deleted',
): void {
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
    detail: nextKnowledgeMutation({ entity, id, operation }),
  }))
}

export default function KnowledgeView({
  userId: _userId,
  mode = 'knowledge',
  initialFiles,
  initialMemories,
  renderFileViewer,
}: {
  userId: string
  mode?: 'knowledge' | 'files'
  initialFiles?: KnowledgeFileNode[]
  initialMemories?: MemoryRow[]
  renderFileViewer(props: { file: KnowledgeFileNode; name: string; content: string; url?: string }): ReactNode
}) {
  void _userId
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [queryPending, startQueryTransition] = useTransition()

  const route = useMemo<SharedKnowledgeRouteState>(() => ({
    file: searchParams?.get('file') ?? null,
    memory: searchParams?.get('memory') ?? null,
    folder: searchParams?.get('folder') ?? null,
    view: searchParams?.get('view') ?? null,
    layout: searchParams?.get('layout') ?? null,
    outputFilter: searchParams?.get('out') ?? null,
  }), [searchParams])

  const updateQuery = useCallback((updates: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    const nextUrl = query ? `${pathname}?${query}` : pathname
    startQueryTransition(() => {
      if (mode === 'files') window.history.pushState(null, '', nextUrl)
      else router.push(nextUrl)
    })
  }, [mode, pathname, router, searchParams])

  // The Files page shows one scope at a time (Personal or Workspace), the same one as the secondary panel.
  const scope = usePanelScope()
  const listView = usePanelListView()
  // Nothing is added to a Workspace its admin restricted.
  const { canCreate } = useWorkspaceCreateAccess()
  const canAdd = canCreate('content', newItemScope(scope) ?? 'personal')

  const adapters = useMemo(() => createWebKnowledgeSurfaceAdapters({
    navigate: (url, options) => options?.replace ? router.replace(url) : router.push(url),
    getScope: () => scope,
    getListView: () => listView,
  }), [router, scope, listView])

  const memories = useMemo<SharedKnowledgeMemoryPort>(() => ({
    list: () => overlayAppClient.memory.get<MemoryRow[]>({ limit: 100 }),
    async create(content) {
      const response = await overlayAppClient.memory.createResponse(createManualMemoryRequest(content))
      return response.ok
        ? { ok: true }
        : { ok: false, error: await responseError(response, 'Could not save memory') }
    },
    async delete(memoryId) {
      return (await overlayAppClient.memory.deleteResponse({ memoryId })).ok
    },
  }), [])

  const files = useMemo<SharedKnowledgeFilePort>(() => ({
    async saveContent(fileId, content) {
      return (await overlayAppClient.files.updateResponse({ fileId, textContent: content })).ok
    },
    upload: (file, parentId) => uploadWebFile(file, parentId, newItemScope(scope)),
    isEditable: isEditableType,
    contentUrl(file) {
      return file.downloadUrl || file.isStorageBacked
        ? `/api/v1/files/${file._id}/content`
        : undefined
    },
    entityChanged(entity, id, operation) {
      publishKnowledgeMutation(entity, id, operation)
    },
  }), [scope])

  // Move and Archive on a hovered row. The item leaves the list being viewed either way, so it is dropped from it.
  const renderRowActions = useCallback((node: KnowledgeFileNode) => (
    <ScopeItemActions
      kind="content"
      resource="files"
      item={node}
      onChanged={() => {
        publishKnowledgeMutation(node.kind === 'note' ? 'note' : 'file', node._id, 'deleted')
        // From an open file, go back to the list it just left.
        if (route.file) updateQuery({ file: null })
      }}
    />
  ), [route.file, updateQuery])

  const renderBulkActions = useCallback(({ nodes, afterChange }: KnowledgeBulkSelection) => (
    <ScopeBulkActions
      kind="content"
      resource="files"
      items={nodes}
      onDone={(changedIds, all) => {
        // The changed items left this list; when every one did, select mode ends too.
        if (all) afterChange()
        for (const node of nodes) {
          if (changedIds.includes(node._id)) publishKnowledgeMutation(node.kind === 'note' ? 'note' : 'file', node._id, 'deleted')
        }
      }}
    />
  ), [])

  return (
    <KnowledgeCreateAccessContext.Provider value={canAdd}>
    <KnowledgeRowActionsContext.Provider value={renderRowActions}>
    <KnowledgeBulkActionsContext.Provider value={renderBulkActions}>
      <SharedKnowledgeSurface
        // A new scope is a different list: start it fresh rather than patching the old one.
        key={scope}
        mode={mode}
        // The server renders the Personal list, so it only seeds that scope.
        initialFiles={scope === 'personal' ? initialFiles : undefined}
        initialMemories={initialMemories}
        route={route}
        queryPending={queryPending}
        onUpdateQuery={updateQuery}
        adapters={adapters}
        memories={memories}
        files={files}
        renderFileViewer={renderFileViewer}
      />
    </KnowledgeBulkActionsContext.Provider>
    </KnowledgeRowActionsContext.Provider>
    </KnowledgeCreateAccessContext.Provider>
  )
}
