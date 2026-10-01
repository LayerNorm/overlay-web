import 'server-only'

import { toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import { getOverlayServerContext } from '@/server/bootstrap'
import { fileService } from '@/server/files/http'
import { NoteRevisionConflictError, NoteService, type NoteRepository } from '@/server/notes'
import { repositoryProxy } from '@/server/app-data/errors'
import { downloadBuffer as downloadR2Buffer } from '@/server/storage/r2'
import { isOwnedStorageKey } from '@/server/files/FileServicePayloads'
import { SANDBOX_SYNC_LIMITS, type WorkspaceFileNode, type WorkspaceFileSource } from './sandbox-file-sync'

/**
 * The sandbox sync's view of one person's files in one workspace, through the
 * same services the web app uses (so quotas, workspace scoping, note
 * normalization, and revision guards all apply).
 */

type FileSummary = {
  _id: string
  name: string
  type: 'file' | 'folder'
  kind?: string
  parentId?: string | null
  r2Key?: string | null
  sizeBytes?: number
  textInObjectStore?: boolean
  updatedAt: number
}

const PAGE_SIZE = 100

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', csv: 'text/csv', md: 'text/markdown',
  txt: 'text/plain', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function mimeTypeFor(name: string): string {
  return MIME_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

function toNode(file: FileSummary): WorkspaceFileNode | null {
  const kind = file.kind === 'note' || file.kind === 'output' || file.kind === 'folder' ? file.kind : 'upload'
  if (file.type === 'folder') {
    return { fileId: file._id, name: file.name, type: 'folder', kind: 'folder', parentId: file.parentId ?? null, updatedAt: file.updatedAt, hasText: false, hasBinary: false }
  }
  // Large text kept in object storage is still a text file.
  const hasBinary = Boolean(file.r2Key) && !file.textInObjectStore
  // Outputs without stored bytes live at a remote URL; there is nothing to mirror.
  if (kind === 'output' && !hasBinary) return null
  return {
    fileId: file._id,
    name: file.name,
    type: 'file',
    kind,
    parentId: file.parentId ?? null,
    updatedAt: file.updatedAt,
    sizeBytes: file.sizeBytes,
    hasText: kind === 'note' || !hasBinary,
    hasBinary,
  }
}

export function createWorkspaceFileSource(scope: { userId: string; workspaceId: string }): WorkspaceFileSource {
  const { userId, workspaceId } = scope
  const repository = () => getOverlayServerContext().appData.repositories.files
  const notes = new NoteService({
    noteRepository: repositoryProxy<NoteRepository>(() => getOverlayServerContext().appData.repositories.notes),
  })

  return {
    async listTree() {
      const nodes: WorkspaceFileNode[] = []
      let cursor: string | null = null
      do {
        const page = await repository().listFilesPage!({ userId, workspaceId, summary: true, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
        for (const file of page.data as FileSummary[]) {
          const node = toNode(file)
          if (node) nodes.push(node)
        }
        cursor = page.hasMore ? page.nextCursor : null
      } while (cursor && nodes.length < SANDBOX_SYNC_LIMITS.maxFiles * 2)
      return nodes
    },

    async readText(node) {
      const file = await fileService.getOrListFiles({ fileId: node.fileId, userId, fullText: true }) as { content?: string; textContent?: string }
      const text = file.textContent ?? file.content ?? ''
      return node.kind === 'note' ? toCanonicalNoteMarkdown(text) : text
    },

    async readBinary(node) {
      const file = await repository().getFile({ fileId: node.fileId, userId })
      const key = typeof file?.r2Key === 'string' ? file.r2Key : null
      if (!key || !isOwnedStorageKey(userId, key)) return null
      const store = getOverlayServerContext().objectStore
      const bytes = store.downloadBuffer
        ? await store.downloadBuffer(key, SANDBOX_SYNC_LIMITS.maxFileBytes)
        : await downloadR2Buffer(key)
      return bytes ? new Uint8Array(bytes) : null
    },

    async updateText(file, text, expectedUpdatedAt) {
      try {
        if (file.mode === 'note') {
          await notes.updateNote({ noteId: file.fileId, content: text, expectedUpdatedAt, userId, workspaceId })
        } else {
          await fileService.updateFile({ userId, workspaceId, body: { fileId: file.fileId, textContent: text, expectedUpdatedAt } })
        }
        return 'ok'
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) return 'conflict'
        if (error instanceof Error && error.name === 'FileServiceError' && (error as { statusCode?: number }).statusCode === 409) return 'conflict'
        throw error
      }
    },

    async createFolder(name, parentId) {
      const result = await fileService.createFile({ userId, workspaceId, body: { name, type: 'folder', kind: 'folder', ...(parentId ? { parentId } : {}) } })
      return String(result.id)
    },

    async createTextFile(name, parentId, text) {
      const result = await fileService.createFile({
        userId,
        workspaceId,
        body: { name, type: 'file', kind: 'upload', mimeType: mimeTypeFor(name), textContent: text, ...(parentId ? { parentId } : {}) },
      })
      return String(result.id)
    },

    async createBinaryFile(name, parentId, bytes) {
      const result = await fileService.createFileFromBytes({ userId, workspaceId, name, parentId, bytes, mimeType: mimeTypeFor(name) })
      return result.id
    },
  }
}
