import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  createKnowledgeMutationPublisher,
  getFileType,
  isEditableType,
  normalizeKnowledgeSurfaceNode,
  type CreateFileResponse,
  type KnowledgeFileNode,
} from '@overlay/app-core'
import {
  SharedKnowledgeSurface,
  type SharedKnowledgeFilePort,
  type SharedKnowledgeMemoryPort,
  type SharedKnowledgeRouteState,
} from '@overlay/modules-react/knowledge'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDesktopKnowledgeSurfaceAdapters,
  createDesktopNoteReplicaPort,
} from '../adapters/desktopKnowledgeSurfaceAdapters'
import { overlayDesktopAppClient } from '../services/app-api-client'
import { createDesktopLocalKnowledgeSurfaceAdapters } from '../adapters/desktopLocalKnowledgeSurfaceAdapters'
import {
  DESKTOP_KNOWLEDGE_AUTHORITY_EVENT,
  getDesktopKnowledgeAuthority,
  type DesktopKnowledgeAuthority,
} from '../services/desktop-knowledge-migration'

const nextKnowledgeMutation = createKnowledgeMutationPublisher(
  `desktop-files:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
)

interface SharedDesktopFilesSurfaceProps {
  selectedFileId: string | null
  onOpenNote(localId: string, remoteId: string): void
  onOpenOutput(id: string): void
  onOpenFile(id: string): void
  onOpenLocalDocument(id: string): void
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null
  return body?.message || body?.error || fallback
}

function uploadedNode(
  response: CreateFileResponse,
  file: File,
  parentId: string | null,
): KnowledgeFileNode | undefined {
  if (!response.id) return undefined
  const now = Date.now()
  return normalizeKnowledgeSurfaceNode({
    _id: response.id,
    name: file.name,
    type: 'file',
    kind: 'upload',
    parentId,
    mimeType: file.type || undefined,
    extension: file.name.split('.').pop()?.toLowerCase(),
    sizeBytes: file.size,
    isStorageBacked: getFileType(file.name) !== 'text' && getFileType(file.name) !== 'markdown' && getFileType(file.name) !== 'csv',
    createdAt: now,
    updatedAt: now,
  })
}

async function uploadDesktopFile(
  file: File,
  parentId: string | null,
): Promise<{ ok: boolean; error?: string; file?: KnowledgeFileNode }> {
  try {
    const fileType = getFileType(file.name)
    if (fileType === 'text' || fileType === 'markdown' || fileType === 'csv') {
      const response = await overlayDesktopAppClient.files.createResponse({
        name: file.name,
        type: 'file',
        kind: 'upload',
        parentId,
        content: await file.text(),
        mimeType: file.type || undefined,
        extension: file.name.split('.').pop()?.toLowerCase(),
      })
      if (!response.ok) return { ok: false, error: await responseError(response, 'Failed to save file') }
      const body = await response.json() as CreateFileResponse
      return { ok: true, file: uploadedNode(body, file, parentId) }
    }

    const uploadUrlResponse = await overlayDesktopAppClient.files.uploadUrlResponse({
      name: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    })
    if (!uploadUrlResponse.ok) {
      return { ok: false, error: await responseError(uploadUrlResponse, 'Could not prepare upload') }
    }
    const { uploadUrl, r2Key } = await uploadUrlResponse.json() as { uploadUrl: string; r2Key: string }
    const uploadResponse = await window.bridge.uploadToStorage({
      url: uploadUrl,
      contentType: file.type || 'application/octet-stream',
      data: await file.arrayBuffer(),
    })
    if (!uploadResponse.ok) return { ok: false, error: 'Storage upload failed. Check your connection and try again.' }
    const createResponse = await overlayDesktopAppClient.files.createResponse({
      name: file.name,
      type: 'file',
      kind: 'upload',
      parentId,
      r2Key,
      sizeBytes: file.size,
      mimeType: file.type || undefined,
      extension: file.name.split('.').pop()?.toLowerCase(),
    })
    if (!createResponse.ok) return { ok: false, error: await responseError(createResponse, 'Failed to save file') }
    const body = await createResponse.json() as CreateFileResponse
    return { ok: true, file: uploadedNode(body, file, parentId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
  }
}

const memories: SharedKnowledgeMemoryPort = {
  async list() { return [] },
  async create() { return { ok: false, error: 'Memories are not available in the files surface.' } },
  async delete() { return false },
}

export function SharedDesktopFilesSurface({
  selectedFileId,
  onOpenNote,
  onOpenOutput,
  onOpenFile,
  onOpenLocalDocument,
}: SharedDesktopFilesSurfaceProps): React.ReactElement<any> {
  const [authority, setAuthority] = useState<DesktopKnowledgeAuthority>(getDesktopKnowledgeAuthority)
  const [route, setRoute] = useState<SharedKnowledgeRouteState>({
    file: null,
    memory: null,
    folder: null,
    view: null,
    layout: 'list',
    outputFilter: null,
  })
  const noteReplicas = useMemo(() => createDesktopNoteReplicaPort(), [])
  useEffect(() => {
    const updateAuthority = (event: Event): void => {
      const next = (event as CustomEvent<DesktopKnowledgeAuthority>).detail
      setAuthority(next || getDesktopKnowledgeAuthority())
    }
    window.addEventListener(DESKTOP_KNOWLEDGE_AUTHORITY_EVENT, updateAuthority)
    return () => window.removeEventListener(DESKTOP_KNOWLEDGE_AUTHORITY_EVENT, updateAuthority)
  }, [])
  const adapters = useMemo(() => authority === 'on-this-mac'
    ? createDesktopLocalKnowledgeSurfaceAdapters({
        onOpenNote: (localId, node) => onOpenNote(localId, node.id),
        onOpenDocument: (localId) => onOpenLocalDocument(localId),
      })
    : createDesktopKnowledgeSurfaceAdapters({
        noteReplicas,
        onOpenNote: (localId, node) => onOpenNote(localId, node.id),
        onOpenOutput,
        onOpenFile,
      }), [authority, noteReplicas, onOpenFile, onOpenLocalDocument, onOpenNote, onOpenOutput])
  const updateRoute = useCallback((updates: Record<string, string | null | undefined>) => {
    setRoute((current) => ({
      ...current,
      file: updates.file === undefined ? current.file : updates.file ?? null,
      memory: updates.memory === undefined ? current.memory : updates.memory ?? null,
      folder: updates.folder === undefined ? current.folder : updates.folder ?? null,
      view: updates.view === undefined ? current.view : updates.view ?? null,
      layout: updates.layout === undefined ? current.layout : updates.layout ?? null,
      outputFilter: updates.out === undefined ? current.outputFilter : updates.out ?? null,
    }))
  }, [])
  const cloudFiles = useMemo<SharedKnowledgeFilePort>(() => ({
    async saveContent(fileId, content) {
      return (await overlayDesktopAppClient.files.updateResponse({ fileId, textContent: content })).ok
    },
    upload: uploadDesktopFile,
    isEditable: isEditableType,
    contentUrl: () => undefined,
    entityChanged(entity, id, operation) {
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
        detail: nextKnowledgeMutation({ entity, id, operation })
      }))
    },
  }), [])
  const localFiles = useMemo<SharedKnowledgeFilePort>(() => ({
    async saveContent() { return false },
    async upload() {
      return { ok: false, error: 'Uploads require a signed-in cloud workspace.' }
    },
    isEditable: () => false,
    contentUrl: () => undefined,
    entityChanged() { return undefined },
  }), [])

  return (
    <div className="shared-app-scope flex h-full min-h-0 w-full flex-col">
      {authority === 'on-this-mac' ? (
        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-xs text-[var(--muted)]">
          On this Mac · local notes and indexed documents
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
      <SharedKnowledgeSurface
        key={authority}
        mode="files"
        initialMemories={[]}
        route={route}
        onUpdateQuery={updateRoute}
        adapters={adapters}
        memories={memories}
        files={authority === 'on-this-mac' ? localFiles : cloudFiles}
        renderFileViewer={() => null}
        openFilesInHost
        selectedFileId={selectedFileId}
        enableExternalDrop
      />
      </div>
    </div>
  )
}
