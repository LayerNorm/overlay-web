import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { skills } from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import type { CreateSkillInput, SkillRecord, SkillRepository, UpdateSkillInput } from './SkillRepository'

type SkillRow = typeof skills.$inferSelect

export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async list(args: { userId: string; projectId?: string; workspaceId?: string }): Promise<SkillRecord[]> {
    const rows = await this.db
      .select()
      .from(skills)
      .where(and(
        eq(skills.userId, args.userId),
        args.projectId ? eq(skills.projectId, args.projectId) : isNull(skills.projectId),
        args.workspaceId ? eq(skills.workspaceId, args.workspaceId) : undefined,
      ))
      .orderBy(desc(skills.updatedAt))
      .limit(200)
    return rows.map(mapSkill)
  }

  async get(args: { skillId: string; userId: string; workspaceId?: string }): Promise<SkillRecord | null> {
    const [row] = await this.db
      .select()
      .from(skills)
      .where(and(
        eq(skills.id, args.skillId),
        eq(skills.userId, args.userId),
        args.workspaceId ? eq(skills.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? mapSkill(row) : null
  }

  async create(args: CreateSkillInput): Promise<string> {
    await assertActivePostgresProject(this.db, args)
    const id = `skill_${randomUUID()}`
    await this.db.insert(skills).values({
      description: args.description.trim(),
      enabled: args.enabled !== false,
      id,
      instructions: args.instructions.trim(),
      name: args.name.trim(),
      projectId: args.projectId,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    return id
  }

  async update(args: UpdateSkillInput): Promise<void> {
    const rows = await this.db
      .update(skills)
      .set({
        ...(args.name !== undefined ? { name: args.name.trim() } : {}),
        ...(args.description !== undefined ? { description: args.description.trim() } : {}),
        ...(args.instructions !== undefined ? { instructions: args.instructions.trim() } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        updatedAt: new Date(),
        ...(args.name !== undefined || args.description !== undefined || args.instructions !== undefined
          ? { version: sql`${skills.version} + 1` }
          : {}),
      })
      .where(and(
        eq(skills.id, args.skillId),
        eq(skills.userId, args.userId),
        args.workspaceId ? eq(skills.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: skills.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }

  async remove(args: { skillId: string; userId: string; workspaceId?: string }): Promise<void> {
    const rows = await this.db
      .delete(skills)
      .where(and(
        eq(skills.id, args.skillId),
        eq(skills.userId, args.userId),
        args.workspaceId ? eq(skills.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: skills.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }
}

function mapSkill(row: SkillRow): SkillRecord {
  return {
    _id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    enabled: row.enabled,
    projectId: row.projectId ?? undefined,
    version: row.version,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}
