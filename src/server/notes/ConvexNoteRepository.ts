import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { hashTextContent } from '@/server/storage/text-content-hash'
import type { NoteRecord, NoteRepository } from './NoteService'

export class ConvexNoteRepository implements NoteRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  private async getCanonicalFile(args: {
    fileId: string
    userId: string
  }): Promise<NoteRecord | null> {
    return await convex.query<NoteRecord | null>('files/files:get', {
      fileId: args.fileId,
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async getNote(args: {
    noteId: string
    userId: string
  }): Promise<NoteRecord | null> {
    let directLookupRejected = false
    const direct = await this.getCanonicalFile({
      fileId: args.noteId,
      userId: args.userId,
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
    }).catch((_error) => null)
    return migrated?.kind === 'note' ? migrated : null
  }

  async listNotes(args: {
    userId: string
    projectId?: string
    includeDeleted?: boolean
  }): Promise<NoteRecord[]> {
    return await convex.query<NoteRecord[]>('files/files:list', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      kind: 'note',
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(args.includeDeleted !== undefined ? { includeDeleted: args.includeDeleted } : {}),
    }) ?? []
  }

  async createNote(args: {
    userId: string
    title: string
    content: string
    projectId?: string
    tags?: string[]
    clientId?: string
  }): Promise<{ id: string; note: NoteRecord | null }> {
    void args.tags
    void args.clientId
    const fileId = await convex.mutation<string>('files/files:create', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      name: args.title,
      kind: 'note',
      type: 'file',
      content: args.content,
      contentHash: args.content ? hashTextContent(args.content) : undefined,
      projectId: args.projectId,
    })
    if (!fileId) {
      throw new Error('Failed to create note')
    }

    const note = await this.getCanonicalFile({
      fileId,
      userId: args.userId,
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
  }): Promise<NoteRecord | null> {
    void args.tags
    const existing = await this.getNote({
      noteId: args.noteId,
      userId: args.userId,
    })
    if (!existing) return null

    await convex.mutation('files/files:update', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      fileId: existing._id,
      name: args.title,
      ...(args.content !== undefined
        ? { content: args.content, contentHash: hashTextContent(args.content) }
        : {}),
      projectId: args.projectId,
    })

    return await this.getCanonicalFile({
      fileId: existing._id,
      userId: args.userId,
    })
  }

  async deleteNote(args: {
    noteId: string
    userId: string
  }): Promise<{ noteId: string; deletedAt: number } | null> {
    const existing = await this.getNote(args)
    if (!existing) return null

    await convex.mutation('files/files:remove', {
      fileId: existing._id,
      userId: args.userId,
      serverSecret: this.serverSecret,
    })

    return {
      noteId: existing._id,
      deletedAt: Date.now(),
    }
  }
}
