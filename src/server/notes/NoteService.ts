import 'server-only'

import type {
  BillingProvider,
  CreateNoteRequest,
  CreateNoteResponse,
  DeleteNoteResponse,
  NoteDoc,
  UpdateNoteRequest,
  UpdateNoteResponse,
} from '@overlay/app-core'
import { BillingQuotaError, QuotaEnforcer } from '@overlay/billing'

export interface NoteRecord {
  _id: string
  userId: string
  clientId?: string
  name: string
  kind?: string
  content?: string
  textContent?: string
  tags?: string[]
  projectId?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
  legacyNoteId?: string
}

export type ServerNoteDoc = NoteDoc & {
  userId: string
  legacyNoteId?: string
}

export interface NoteRepository {
  getNote(args: { noteId: string; userId: string }): Promise<NoteRecord | null>
  listNotes(args: {
    userId: string
    projectId?: string
    includeDeleted?: boolean
  }): Promise<NoteRecord[]>
  createNote(args: {
    userId: string
    title: string
    content: string
    projectId?: string
    tags?: string[]
    clientId?: string
  }): Promise<{ id: string; note: NoteRecord | null }>
  updateNote(args: {
    noteId: string
    userId: string
    title?: string
    content?: string
    projectId?: string | null
    tags?: string[]
  }): Promise<NoteRecord | null>
  deleteNote(args: {
    noteId: string
    userId: string
  }): Promise<{ noteId: string; deletedAt: number } | null>
}

export class NoteServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'NoteServiceError'
  }
}

function normalizeNoteTitle(value: string | undefined): string {
  return value?.trim() || 'Untitled'
}

function noteRecordToDoc(note: NoteRecord): ServerNoteDoc {
  return {
    _id: note._id,
    userId: note.userId,
    title: note.name || 'Untitled',
    content: note.textContent ?? note.content ?? '',
    tags: note.tags ?? [],
    projectId: note.projectId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
    clientId: note.clientId,
    legacyNoteId: note.legacyNoteId,
  }
}

export class NoteService {
  constructor(private readonly context: {
    billing?: Pick<BillingProvider, 'getEntitlements'>
    noteRepository: NoteRepository
  }) {}

  async getNote(args: {
    userId: string
    noteId: string
  }): Promise<ServerNoteDoc | null> {
    const note = await this.context.noteRepository.getNote(args)
    return note ? noteRecordToDoc(note) : null
  }

  async listNotes(args: {
    userId: string
    projectId?: string
    includeDeleted?: boolean
  }): Promise<ServerNoteDoc[]> {
    const notes = await this.context.noteRepository.listNotes(args)
    return notes.map(noteRecordToDoc)
  }

  async createNote(
    args: Omit<CreateNoteRequest, 'accessToken' | 'userId'> & { userId: string },
  ): Promise<CreateNoteResponse> {
    await this.assertWriteQuota(args.userId)
    const content = args.content ?? ''
    const result = await this.context.noteRepository.createNote({
      userId: args.userId,
      title: normalizeNoteTitle(args.title),
      content,
      projectId: args.projectId,
      tags: args.tags,
      clientId: args.clientId,
    })
    return {
      id: result.id,
      note: result.note ? noteRecordToDoc(result.note) : null,
    }
  }

  async updateNote(
    args: Omit<UpdateNoteRequest, 'accessToken' | 'userId'> & { userId: string },
  ): Promise<UpdateNoteResponse> {
    if (!args.noteId) {
      throw new NoteServiceError('noteId required', 400)
    }

    const note = await this.context.noteRepository.updateNote({
      noteId: args.noteId,
      userId: args.userId,
      title: args.title,
      content: args.content,
      projectId: args.projectId,
      tags: args.tags,
    })
    if (!note) {
      throw new NoteServiceError('Not found', 404)
    }

    return {
      success: true,
      note: noteRecordToDoc(note),
    }
  }

  async deleteNote(args: {
    userId: string
    noteId: string | null
  }): Promise<DeleteNoteResponse> {
    if (!args.noteId) {
      throw new NoteServiceError('noteId required', 400)
    }

    const result = await this.context.noteRepository.deleteNote({
      noteId: args.noteId,
      userId: args.userId,
    })
    if (!result) {
      throw new NoteServiceError('Not found', 404)
    }

    return {
      success: true,
      noteId: result.noteId,
      deletedAt: result.deletedAt,
    }
  }

  private async assertWriteQuota(userId: string): Promise<void> {
    if (!this.context.billing) return
    try {
      await new QuotaEnforcer(this.context.billing).assertAllowed({ userId, kind: 'write' })
    } catch (error) {
      if (error instanceof BillingQuotaError) {
        throw new NoteServiceError(error.message, 402)
      }
      throw error
    }
  }
}
