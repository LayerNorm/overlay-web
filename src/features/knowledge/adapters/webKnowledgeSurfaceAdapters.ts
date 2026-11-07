'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { newItemScope, parsePanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import { buildWorkspaceHandleHref, buildWorkspaceHref, readWorkspacePathScope, readWorkspaceRouteTarget } from '@/shared/workspaces/routing'
import {
  opensInDocumentEditor,
  normalizeKnowledgeSurfaceNode,
  type FileNavigationAdapter,
  type FilePickerAdapter,
  type CreateFileRequest,
  type KnowledgeAnalyticsAdapter,
  type KnowledgeCreateInput,
  type KnowledgeDeleteInput,
  type KnowledgeFile,
  type KnowledgePickedFile,
  type KnowledgeRenameInput,
  type KnowledgeRepository,
  type KnowledgeRouteAdapter,
  type KnowledgeSurfaceAdapters,
  type KnowledgeSurfaceNode,
  type KnowledgeSurfaceRouteState,
  type KnowledgeMoveInput,
  type UpdateFileRequest,
} from '@overlay/app-core'

interface FilesClientLike {
  getResponse(query: { fileId: string; fullText?: boolean }, options?: { signal?: AbortSignal }): Promise<Response>
  createResponse(input: CreateFileRequest): Promise<Response>
  updateResponse(input: UpdateFileRequest): Promise<Response>
  deleteResponse(input: { fileId: string }): Promise<Response>
}

export interface WebKnowledgeAppClient {
  files: FilesClientLike
}

type KnowledgeEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

function responseError(response: Response, fallback: string): Promise<Error> {
  return response.json()
    .catch(() => null)
    .then((body: { error?: string; message?: string } | null) =>
      new Error(body?.message || body?.error || fallback),
    )
}

async function responseNode(response: Response, fallback: KnowledgeCreateInput): Promise<KnowledgeSurfaceNode> {
  if (!response.ok) throw await responseError(response, 'Knowledge mutation failed')
  const body = await response.json() as { id?: string; file?: KnowledgeFile | null }
  if (body.file) return normalizeKnowledgeSurfaceNode(body.file)
  if (!body.id) throw new Error('Knowledge mutation returned no file identifier')
  const now = Date.now()
  return normalizeKnowledgeSurfaceNode({
    _id: body.id,
    clientId: fallback.clientId,
    name: fallback.name,
    type: fallback.kind === 'folder' ? 'folder' : 'file',
    kind: fallback.kind,
    parentId: fallback.parentId,
    content: fallback.content,
    mimeType: fallback.mimeType,
    extension: fallback.extension,
    createdAt: now,
    updatedAt: now,
  })
}

/** File and folder renames and moves, applied natively by the host (see `useFileTreeCommands`). */
export interface WebKnowledgeTreeCommands {
  rename(fileId: string, name: string): Promise<void>
  move(fileId: string, parentId: string | null): Promise<void>
}

/**
 * Commands and one-file reads for the shared surface. Lists are not here: the host passes its live Convex tree.
 * Create and delete stay on the server, which places large text and cleans up object storage.
 */
export function createWebKnowledgeRepository(
  commands: WebKnowledgeTreeCommands,
  client: WebKnowledgeAppClient = overlayAppClient,
  /** The scope being viewed: new files are created in it. */
  getScope: () => PanelScope = () => 'personal',
): KnowledgeRepository {
  async function get(id: string, signal?: AbortSignal): Promise<KnowledgeSurfaceNode | null> {
    const response = await client.files.getResponse({ fileId: id, fullText: true }, { signal })
    if (response.status === 404) return null
    if (!response.ok) throw await responseError(response, 'Could not load file')
    return normalizeKnowledgeSurfaceNode(await response.json() as KnowledgeFile)
  }
  return {
    get,
    async create(input) {
      return await responseNode(await client.files.createResponse({
        name: input.name,
        type: input.kind === 'folder' ? 'folder' : 'file',
        kind: input.kind === 'file' ? 'upload' : input.kind,
        parentId: input.parentId,
        content: input.content,
        textContent: input.kind === 'note' ? input.content ?? '' : undefined,
        mimeType: input.mimeType,
        extension: input.extension,
        clientId: input.clientId,
        scope: newItemScope(getScope()),
      }), input)
    },
    rename: (input: KnowledgeRenameInput) => commands.rename(input.id, input.name),
    move: (input: KnowledgeMoveInput) => commands.move(input.id, input.parentId),
    async delete(input: KnowledgeDeleteInput) {
      await Promise.all(input.ids.map(async (id) => {
        const response = await client.files.deleteResponse({ fileId: id })
        if (!response.ok) throw await responseError(response, 'Could not delete file')
      }))
    },
  }
}

function routeFromUrl(url: URL): KnowledgeSurfaceRouteState {
  const layoutParam = url.searchParams.get('layout')
  return {
    folderId: url.searchParams.get('folder'),
    fileId: url.searchParams.get('file'),
    query: url.searchParams.get('q') ?? '',
    layout: layoutParam === 'cards' || layoutParam === 'grid' ? 'grid' : 'list',
  }
}

export function createWebKnowledgeRouteAdapter(options: {
  currentUrl?: () => URL
  navigate?: (url: string, replace: boolean) => void
  eventTarget?: KnowledgeEventTarget | null
} = {}): KnowledgeRouteAdapter {
  const currentUrl = options.currentUrl ?? (() => new URL(window.location.href))
  const navigate = options.navigate ?? ((url, replace) => {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  })
  return {
    read: () => routeFromUrl(currentUrl()),
    write(route, writeOptions) {
      const url = currentUrl()
      const entries: Array<[string, string | null]> = [
        ['folder', route.folderId],
        ['file', route.fileId],
        ['q', route.query || null],
        ['layout', route.layout === 'grid' ? 'cards' : 'list'],
      ]
      for (const [key, value] of entries) {
        if (value) url.searchParams.set(key, value)
        else url.searchParams.delete(key)
      }
      navigate(`${url.pathname}${url.search}${url.hash}`, Boolean(writeOptions?.replace))
    },
    subscribe(listener) {
      const target = options.eventTarget ?? window
      const handlePopState = () => listener(routeFromUrl(currentUrl()))
      target.addEventListener('popstate', handlePopState)
      return () => target.removeEventListener('popstate', handlePopState)
    },
  }
}

function browserPickedFile(file: File): KnowledgePickedFile {
  return {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    relativePath: file.webkitRelativePath || undefined,
    async read() {
      return new Uint8Array(await file.arrayBuffer())
    },
  }
}

function pickWithInput(options: { multiple?: boolean; accept?: string; directory?: boolean }): Promise<readonly KnowledgePickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options.multiple || options.directory)
    input.accept = options.accept ?? ''
    if (options.directory) input.setAttribute('webkitdirectory', '')
    input.addEventListener('change', () => resolve(Array.from(input.files ?? []).map(browserPickedFile)), { once: true })
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

export function createWebFilePickerAdapter(
  picker: typeof pickWithInput = pickWithInput,
): FilePickerAdapter {
  return {
    pickFiles: (options) => picker(options ?? {}),
    pickFolder: () => picker({ directory: true, multiple: true }),
  }
}

export function createWebKnowledgeSurfaceAdapters(options: {
  commands: WebKnowledgeTreeCommands
  client?: WebKnowledgeAppClient
  route?: KnowledgeRouteAdapter
  filePicker?: FilePickerAdapter
  navigate?: (url: string, options?: { replace?: boolean }) => void
  capture?: (event: string, properties?: Record<string, unknown>) => void
  eventTarget?: KnowledgeEventTarget | null
  currentUrl?: () => URL
  getScope?: () => PanelScope
}): KnowledgeSurfaceAdapters {
  const navigate = options.navigate ?? ((url) => window.location.assign(url))
  const currentUrl = options.currentUrl ?? (() => (
    typeof window === 'undefined'
      ? new URL('https://workspace.invalid/app/files')
      : new URL(window.location.href)
  ))
  const scopedHref = (path: string) => {
    const current = currentUrl()
    const route = readWorkspaceRouteTarget(current.pathname)
    const scope = readWorkspacePathScope(current.pathname)
      ?? parsePanelScope(current.searchParams.get('scope'))
      ?? options.getScope?.()
    if (route?.kind === 'handle') return buildWorkspaceHandleHref(route.value, path, scope)
    if (route?.kind === 'id') return buildWorkspaceHref(route.value, path)
    return path
  }
  const navigation: FileNavigationAdapter = {
    open(node, navigationOptions) {
      // KnowledgeSurfaceNode declares both `id` and `_id`, but the rows the API
      // returns only carry `_id` — so `node.id` was undefined and this navigated
      // to `/app/notes?id=undefined`, which 404s and renders blank. TypeScript
      // could not catch it because the interface promises both fields and the
      // surface casts on the way in. Every other caller keys off `_id`.
      const nodeId = node._id ?? node.id
      if (opensInDocumentEditor(node)) navigate(scopedHref(`/app/notes?id=${encodeURIComponent(nodeId)}`), navigationOptions)
      else navigate(scopedHref(`/app/files?file=${encodeURIComponent(nodeId)}`), navigationOptions)
    },
  }
  const analytics: KnowledgeAnalyticsAdapter = {
    track(event, properties) {
      options.capture?.(event, properties ?? {})
    },
  }
  return {
    repository: createWebKnowledgeRepository(options.commands, options.client, options.getScope),
    route: options.route ?? createWebKnowledgeRouteAdapter({ eventTarget: options.eventTarget ?? undefined }),
    filePicker: options.filePicker ?? createWebFilePickerAdapter(),
    navigation,
    analytics,
  }
}
