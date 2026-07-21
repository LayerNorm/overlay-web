'use client'

// Compatibility wrapper: Next routing and web transport stay in the host while
// the complete files/knowledge experience lives in @overlay/modules-react.
import { getFileType, isEditableType } from '@/shared/files/file-viewer-types'
import { shouldIngestDocument } from '@/shared/files/file-ingestion'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  FILES_CHANGED_EVENT,
  normalizeKnowledgeSurfaceNode,
  createManualMemoryRequest,
  type CreateFileResponse,
  type KnowledgeFileNode,
  type MemoryRow,
} from '@overlay/app-core'
import {
  SharedKnowledgeSurface,
  type SharedKnowledgeFilePort,
  type SharedKnowledgeMemoryPort,
  type SharedKnowledgeRouteState,
} from '@overlay/modules-react/knowledge'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useTransition } from 'react'
import { createWebKnowledgeSurfaceAdapters } from '../adapters/webKnowledgeSurfaceAdapters'

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null
  return body?.message || body?.error || fallback
}

async function uploadWebFile(
  file: File,
  parentId: string | null,
): Promise<{ ok: boolean; error?: string; file?: KnowledgeFileNode }> {
  const createdResult = async (response: Response, fallback: string) => {
    if (!response.ok) return { ok: false, error: await responseError(response, fallback) }
    const body = await response.json() as CreateFileResponse
    if (!body.id) return { ok: false, error: 'The server did not return the uploaded file.' }
    const now = Date.now()
    return {
      ok: true,
      file: normalizeKnowledgeSurfaceNode({
        _id: body.id,
        name: file.name,
        type: 'file',
        kind: 'upload',
        parentId,
        mimeType: file.type || undefined,
        extension: file.name.split('.').pop()?.toLowerCase(),
        sizeBytes: file.size,
        isStorageBacked: file.size > 0,
        createdAt: now,
        updatedAt: now,
      }),
    }
  }
  try {
    if (shouldIngestDocument(file.name)) {
      const form = new FormData()
      form.append('file', file)
      if (parentId) form.append('parentId', parentId)
      const response = await overlayAppClient.files.ingestDocumentResponse(form)
      return createdResult(response, 'Failed to index document')
    }

    const fileType = getFileType(file.name)
    if (fileType === 'text' || fileType === 'markdown' || fileType === 'csv') {
      const response = await overlayAppClient.files.createResponse({
        name: file.name,
        type: 'file',
        parentId,
        content: await file.text(),
      })
      return createdResult(response, 'Failed to save file')
    }

    const uploadUrlResponse = await overlayAppClient.files.uploadUrlResponse({
      sizeBytes: file.size,
      name: file.name,
      mimeType: file.type || undefined,
    })
    if (!uploadUrlResponse.ok) {
      return { ok: false, error: await responseError(uploadUrlResponse, 'Could not prepare upload') }
    }
    const { uploadUrl, r2Key } = await uploadUrlResponse.json() as {
      uploadUrl: string
      r2Key: string
    }
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!uploadResponse.ok) {
      return { ok: false, error: 'Storage upload failed. Check your connection and try again.' }
    }
    const createResponse = await overlayAppClient.files.createResponse({
      name: file.name,
      type: 'file',
      parentId,
      r2Key,
      sizeBytes: file.size,
    })
    return createdResult(createResponse, 'Failed to save file')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
  }
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

  const adapters = useMemo(() => createWebKnowledgeSurfaceAdapters({
    navigate: (url, options) => options?.replace ? router.replace(url) : router.push(url),
    eventTarget: null,
  }), [router])

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
    upload: uploadWebFile,
    isEditable: isEditableType,
    contentUrl(file) {
      return file.downloadUrl || file.isStorageBacked
        ? `/api/v1/files/${file._id}/content`
        : undefined
    },
    filesChanged() {
      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT))
    },
    noteCreated(file) {
      window.dispatchEvent(new CustomEvent('overlay:notes-changed', { detail: { file } }))
    },
  }), [])

  return (
    <SharedKnowledgeSurface
      mode={mode}
      initialFiles={initialFiles}
      initialMemories={initialMemories}
      route={route}
      queryPending={queryPending}
      onUpdateQuery={updateQuery}
      adapters={adapters}
      memories={memories}
      files={files}
      renderFileViewer={renderFileViewer}
    />
  )
}
