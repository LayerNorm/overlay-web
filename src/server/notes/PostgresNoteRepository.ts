import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { notes } from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import type { NoteRecord, NoteRepository } from './NoteService'

export class PostgresNoteRepository implements NoteRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getNote(args: {
    noteId: string
    userId: string
  }): Promise<NoteRecord | null> {
    const [row] = await this.db
      .select()
      .from(notes)
      .where(and(
        eq(notes.id, args.noteId),
        eq(notes.userId, args.userId),
        isNull(notes.deletedAt),
      ))
      .limit(1)
    return row ? noteRowToRecord(row) : null
  }

  async listNotes(args: {
    userId: string
    projectId?: string
    includeDeleted?: boolean
  }): Promise<NoteRecord[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(and(
        eq(notes.userId, args.userId),
        ...(args.projectId !== undefined ? [eq(notes.projectId, args.projectId)] : []),
        ...(args.includeDeleted ? [] : [isNull(notes.deletedAt)]),
      ))
      .orderBy(desc(notes.updatedAt))
    return rows.map(noteRowToRecord)
  }

  async createNote(args: {
    userId: string
    title: string
    content: string
    projectId?: string
    tags?: string[]
    clientId?: string
  }): Promise<{ id: string; note: NoteRecord | null }> {
    const now = new Date()
    const id = `note_${randomUUID()}`
    const [row] = await this.db.transaction(async (tx) => {
      await assertActivePostgresProject(tx, {
        projectId: args.projectId,
        userId: args.userId,
      })
      return await tx
        .insert(notes)
        .values({
          id,
          userId: args.userId,
          clientId: args.clientId,
          title: args.title,
          content: args.content,
          tags: args.tags ?? [],
          projectId: args.projectId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [notes.userId, notes.clientId],
          set: {
            title: args.title,
            content: args.content,
            tags: args.tags ?? [],
            projectId: args.projectId,
            updatedAt: now,
            deletedAt: null,
          },
        })
        .returning()
    })

    return {
      id: row?.id ?? id,
      note: row ? noteRowToRecord(row) : await this.getNote({ noteId: id, userId: args.userId }),
    }
  }

  async updateNote(args: {
    noteId: string
    userId: string
    title?: string
    content?: string
    projectId?: string | null
    tags?: string[]
  }): Promise<NoteRecord | null> {
    const set: Partial<typeof notes.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (args.title !== undefined) set.title = args.title
    if (args.content !== undefined) set.content = args.content
    if (args.projectId !== undefined) set.projectId = args.projectId
    if (args.tags !== undefined) set.tags = args.tags

    const [row] = await this.db.transaction(async (tx) => {
      if (args.projectId !== undefined) {
        await assertActivePostgresProject(tx, {
          projectId: args.projectId,
          userId: args.userId,
        })
      }
      return await tx
        .update(notes)
        .set(set)
        .where(and(
          eq(notes.id, args.noteId),
          eq(notes.userId, args.userId),
          isNull(notes.deletedAt),
        ))
        .returning()
    })
    return row ? noteRowToRecord(row) : null
  }

  async deleteNote(args: {
    noteId: string
    userId: string
  }): Promise<{ noteId: string; deletedAt: number } | null> {
    const deletedAt = new Date()
    const [row] = await this.db
      .update(notes)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(and(
        eq(notes.id, args.noteId),
        eq(notes.userId, args.userId),
        isNull(notes.deletedAt),
      ))
      .returning({ id: notes.id })
    return row ? { noteId: row.id, deletedAt: deletedAt.getTime() } : null
  }
}

type NoteRow = typeof notes.$inferSelect

function noteRowToRecord(row: NoteRow): NoteRecord {
  return {
    _id: row.id,
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    name: row.title,
    kind: 'note',
    content: row.content,
    textContent: row.content,
    tags: row.tags ?? [],
    projectId: row.projectId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}
