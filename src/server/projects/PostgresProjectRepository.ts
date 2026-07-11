import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  conversations,
  files,
  notes,
  projects,
} from '@/server/database/postgres/schema'
import { emitPostgresConversationEvent } from '@/server/conversations/PostgresConversationEvents'
import { enqueueStorageCleanupJobs } from '@/server/storage/PostgresStorageCleanupJobs'
import type {
  DeleteProjectTreeResult,
  ProjectRecord,
  ProjectRepository,
} from './ProjectRepository'
import { ProjectRepositoryError } from './ProjectRepository'

type ProjectRow = typeof projects.$inferSelect

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getProject(args: {
    projectId: string
    userId: string
  }): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(
        eq(projects.id, args.projectId),
        eq(projects.userId, args.userId),
        isNull(projects.deletedAt),
      ))
      .limit(1)
    return row ? mapProjectRow(row) : null
  }

  async listProjects(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
  }): Promise<ProjectRecord[]> {
    const updatedSince = finiteDate(args.updatedSince)
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(
        eq(projects.userId, args.userId),
        args.includeDeleted ? undefined : isNull(projects.deletedAt),
        updatedSince ? gt(projects.updatedAt, updatedSince) : undefined,
      ))
      .orderBy(asc(projects.createdAt))
    return rows.map(mapProjectRow)
  }

  async createProject(args: {
    clientId?: string
    instructions?: string
    name: string
    parentId?: string | null
    userId: string
  }): Promise<ProjectRecord> {
    return await this.db.transaction(async (tx) => {
      await lockProjectHierarchy(tx, args.userId)
      const now = new Date()
      const id = `project_${randomUUID()}`
      const values = {
        id,
        userId: args.userId,
        clientId: normalizeOptional(args.clientId),
        name: args.name,
        instructions: normalizeOptional(args.instructions),
        parentId: normalizeOptional(args.parentId),
        createdAt: now,
        updatedAt: now,
      }
      if (values.clientId) {
        const [existing] = await tx
          .select()
          .from(projects)
          .where(and(
            eq(projects.userId, args.userId),
            eq(projects.clientId, values.clientId),
          ))
          .limit(1)
        if (existing && !existing.deletedAt) return mapProjectRow(existing)
        if (existing) {
          const allProjects = await tx
            .select()
            .from(projects)
            .where(eq(projects.userId, args.userId))
          validateParentChange(allProjects, {
            parentId: values.parentId,
            projectId: existing.id,
            userId: args.userId,
          })
          const [revived] = await tx
            .update(projects)
            .set({
              deletedAt: null,
              instructions: values.instructions,
              name: values.name,
              parentId: values.parentId,
              updatedAt: now,
            })
            .where(eq(projects.id, existing.id))
            .returning()
          if (!revived) throw new Error('Failed to revive project')
          return mapProjectRow(revived)
        }
      }
      await assertValidParent(tx, {
        parentId: args.parentId,
        userId: args.userId,
      })
      const [row] = await tx.insert(projects).values(values).returning()
      if (!row) throw new Error('Failed to create project')
      return mapProjectRow(row)
    })
  }

  async updateProject(args: {
    instructions?: string | null
    name?: string
    parentId?: string | null
    projectId: string
    userId: string
  }): Promise<ProjectRecord | null> {
    return await this.db.transaction(async (tx) => {
      await lockProjectHierarchy(tx, args.userId)
      const allProjects = await tx
        .select()
        .from(projects)
        .where(eq(projects.userId, args.userId))
      const current = allProjects.find((project) => (
        project.id === args.projectId && !project.deletedAt
      ))
      if (!current) return null

      if (args.parentId !== undefined) {
        validateParentChange(allProjects, {
          parentId: args.parentId,
          projectId: args.projectId,
          userId: args.userId,
        })
      }

      const [row] = await tx
        .update(projects)
        .set({
          ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.parentId !== undefined ? { parentId: normalizeOptional(args.parentId) } : {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(projects.id, args.projectId),
          eq(projects.userId, args.userId),
          isNull(projects.deletedAt),
        ))
        .returning()
      return row ? mapProjectRow(row) : null
    })
  }

  async deleteProjectTree(args: {
    projectId: string
    userId: string
  }): Promise<DeleteProjectTreeResult | null> {
    return await this.db.transaction(async (tx) => {
      await lockProjectHierarchy(tx, args.userId)
      const allProjects = await tx
        .select()
        .from(projects)
        .where(eq(projects.userId, args.userId))
      const root = allProjects.find((project) => (
        project.id === args.projectId && !project.deletedAt
      ))
      if (!root) return null
      const deletedIds = collectDescendants(allProjects, args.projectId)
      const now = new Date()

      const deletedConversations = await tx
        .update(conversations)
        .set({ deletedAt: now, lastModified: now, updatedAt: now })
        .where(and(
          eq(conversations.userId, args.userId),
          inArray(conversations.projectId, deletedIds),
          isNull(conversations.deletedAt),
        ))
        .returning({ id: conversations.id })
      for (const conversation of deletedConversations) {
        await emitPostgresConversationEvent(tx, {
          conversationId: conversation.id,
          type: 'conversation.deleted',
          userId: args.userId,
        })
      }

      const deletedNotes = await tx
        .update(notes)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(
          eq(notes.userId, args.userId),
          inArray(notes.projectId, deletedIds),
          isNull(notes.deletedAt),
        ))
        .returning({ id: notes.id })

      const projectFiles = await tx
        .select()
        .from(files)
        .where(and(
          eq(files.userId, args.userId),
          inArray(files.projectId, deletedIds),
          isNull(files.deletedAt),
        ))
      const projectFileIds = projectFiles.map((file) => file.id)
      for (const canonical of projectFiles.filter((file) => file.type === 'file' && !file.duplicateOfFileId)) {
        const [promoted] = await tx
          .select()
          .from(files)
          .where(and(
            eq(files.userId, args.userId),
            eq(files.duplicateOfFileId, canonical.id),
            projectFileIds.length > 0 ? notInArray(files.id, projectFileIds) : undefined,
            isNull(files.deletedAt),
          ))
          .orderBy(asc(files.createdAt))
          .limit(1)
        if (!promoted) continue
        await tx
          .update(files)
          .set({ duplicateOfFileId: null, indexStatus: 'pending', updatedAt: now })
          .where(eq(files.id, promoted.id))
        await tx
          .update(files)
          .set({ duplicateOfFileId: promoted.id, updatedAt: now })
          .where(and(
            eq(files.userId, args.userId),
            eq(files.duplicateOfFileId, canonical.id),
            ne(files.id, promoted.id),
            projectFileIds.length > 0 ? notInArray(files.id, projectFileIds) : undefined,
            isNull(files.deletedAt),
          ))
      }

      const deletedFiles = await tx
        .update(files)
        .set({ deletedAt: now, indexStatus: 'skipped', updatedAt: now })
        .where(and(
          eq(files.userId, args.userId),
          inArray(files.projectId, deletedIds),
          isNull(files.deletedAt),
        ))
        .returning({ id: files.id, r2Key: files.r2Key })

      await enqueueStorageCleanupJobs(tx, {
        dedupeKey: `project-delete:${args.projectId}`,
        keys: deletedFiles.flatMap((file) => file.r2Key ? [file.r2Key] : []),
        reason: 'project-delete',
        userId: args.userId,
      })

      await tx
        .update(projects)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(
          eq(projects.userId, args.userId),
          inArray(projects.id, deletedIds),
          isNull(projects.deletedAt),
        ))

      return {
        deletedAt: now.getTime(),
        deletedIds,
        deletedConversationIds: deletedConversations.map(({ id }) => id),
        deletedFileIds: deletedFiles.map(({ id }) => id),
        deletedNoteIds: deletedNotes.map(({ id }) => id),
      }
    })
  }
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    _id: row.id,
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    name: row.name,
    instructions: row.instructions ?? undefined,
    parentId: row.parentId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}

async function lockProjectHierarchy(
  db: Pick<OverlayPostgresDb, 'execute'>,
  userId: string,
): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
}

async function assertValidParent(
  db: Pick<OverlayPostgresDb, 'select'>,
  args: { parentId?: string | null; userId: string },
): Promise<void> {
  if (!args.parentId) return
  const [parent] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.id, args.parentId),
      eq(projects.userId, args.userId),
      isNull(projects.deletedAt),
    ))
    .limit(1)
  if (!parent) {
    throw new ProjectRepositoryError('Invalid parent project', 'invalid_parent')
  }
}

function validateParentChange(
  allProjects: ProjectRow[],
  args: { parentId?: string | null; projectId: string; userId: string },
): void {
  if (!args.parentId) return
  if (args.parentId === args.projectId) {
    throw new ProjectRepositoryError('Project cannot be its own parent', 'parent_cycle')
  }
  const byId = new Map(allProjects.map((project) => [project.id, project]))
  const parent = byId.get(args.parentId)
  if (!parent || parent.userId !== args.userId || parent.deletedAt) {
    throw new ProjectRepositoryError('Invalid parent project', 'invalid_parent')
  }
  const seen = new Set<string>([args.projectId])
  let cursor: ProjectRow | undefined = parent
  while (cursor) {
    if (seen.has(cursor.id)) {
      throw new ProjectRepositoryError('Project parent cycle detected', 'parent_cycle')
    }
    seen.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
}

function collectDescendants(allProjects: ProjectRow[], rootId: string): string[] {
  const result = [rootId]
  const seen = new Set(result)
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]!
    for (const project of allProjects) {
      if (project.parentId !== current || project.deletedAt || seen.has(project.id)) continue
      seen.add(project.id)
      result.push(project.id)
    }
  }
  return result
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function finiteDate(value: number | undefined): Date | undefined {
  return value !== undefined && Number.isFinite(value) ? new Date(value) : undefined
}
