import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { hashTextContent } from '@/server/storage/text-content-hash'
import { NoteRevisionConflictError, type NoteRecord, type NoteRepository } from './NoteService'

export class ConvexNoteRepository implements NoteRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  private async getCanonicalFile(args: {
    fileId: string
    userId: string
    workspaceId?: string
  }): Promise<NoteRecord | null> {
    return await convex.query<NoteRecord | null>('files/files:get', {
      fileId: args.fileId,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
  }

  async getNote(args: {
    noteId: string
    userId: string
    workspaceId?: string
  }): Promise<NoteRecord | null> {
    let directLookupRejected = false
    const direct = await this.getCanonicalFile({
      fileId: args.noteId,
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }).catch((_error) => {
      directLookupRejected = true
      return null
    })
    if (direct?.kind === 'note') return direct
    if (!directLookupRejected) return null

    const migrated = await convex.query<NoteRecord | null>('files/files:getByLegacyNoteId', {
      noteId: args.noteId,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }).catch((_error) => null)
    return migrated?.kind === 'note' ? migrated : null
  }

  async listNotes(args: {
    userId: string
    projectId?: string
    includeDeleted?: boolean
    workspaceId?: string
  }): Promise<NoteRecord[]> {
    return await convex.query<NoteRecord[]>('files/files:list', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      kind: 'note',
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(args.includeDeleted !== undefined ? { includeDeleted: args.includeDeleted } : {}),
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }) ?? []
  }

  async createNote(args: {
    userId: string
    title: string
    content: string
    projectId?: string
    tags?: string[]
    clientId?: string
    workspaceId?: string
  }): Promise<{ id: string; note: NoteRecord | null }> {
    void args.tags
    const fileId = await convex.mutation<string>('files/files:create', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      clientId: args.clientId,
      name: args.title,
      kind: 'note',
      type: 'file',
      content: args.content,
      contentHash: args.content ? hashTextContent(args.content) : undefined,
      projectId: args.projectId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
    if (!fileId) {
      throw new Error('Failed to create note')
    }

    const note = await this.getCanonicalFile({
      fileId,
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
    return { id: fileId, note }
  }

  async updateNote(args: {
    noteId: string
    userId: string
    title?: string
    content?: string
    projectId?: string | null
    tags?: string[]
    expectedUpdatedAt?: number
    workspaceId?: string
  }): Promise<NoteRecord | null> {
    void args.tags
    const existing = await this.getNote({
      noteId: args.noteId,
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
    if (!existing) return null

    try {
      await convex.mutation('files/files:update', {
        userId: args.userId,
        serverSecret: this.serverSecret,
        fileId: existing._id,
        name: args.title,
        ...(args.content !== undefined
          ? { content: args.content, contentHash: hashTextContent(args.content) }
          : {}),
        projectId: args.projectId,
        ...(args.expectedUpdatedAt !== undefined
          ? { expectedUpdatedAt: args.expectedUpdatedAt }
          : {}),
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOTE_REVISION_CONFLICT')) {
        const current = await this.getNote({ noteId: args.noteId, userId: args.userId, ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}) })
        throw new NoteRevisionConflictError(args.expectedUpdatedAt, current?.updatedAt ?? existing.updatedAt)
      }
      throw error
    }

    return await this.getCanonicalFile({
      fileId: existing._id,
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
  }

  async deleteNote(args: {
    noteId: string
    userId: string
    workspaceId?: string
  }): Promise<{ noteId: string; deletedAt: number } | null> {
    const existing = await this.getNote(args)
    if (!existing) return null

    await convex.mutation('files/files:remove', {
      fileId: existing._id,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })

    return {
      noteId: existing._id,
      deletedAt: Date.now(),
    }
  }
}
