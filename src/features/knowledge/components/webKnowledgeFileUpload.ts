'use client'

import { getFileType } from '@/shared/files/file-viewer-types'
import { shouldIngestDocument } from '@/shared/files/file-ingestion'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  normalizeKnowledgeSurfaceNode,
  type CreateFileResponse,
  type KnowledgeFileNode,
} from '@overlay/app-core'

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null
  return body?.message || body?.error || fallback
}

async function uploadWebFile(
  file: File,
  parentId: string | null,
  scope?: 'workspace',
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
      if (scope) form.append('scope', scope)
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
        scope,
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
      scope,
    })
    return createdResult(createResponse, 'Failed to save file')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
  }
}

export { responseError, uploadWebFile }
