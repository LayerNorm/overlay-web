import 'server-only'

import { and, asc, eq } from 'drizzle-orm'
import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { computers } from '@/server/database/postgres/schema'
import type { ComputerRepository } from './ComputerRepository'

type ComputerRow = typeof computers.$inferSelect

export class PostgresComputerRepository implements ComputerRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async create(row: Computer): Promise<Computer> {
    const [inserted] = await this.db
      .insert(computers)
      .values({
        id: row.id,
        workspaceId: row.workspaceId,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        provider: row.provider,
        providerRef: row.providerRef,
        size: row.size,
        status: row.status,
        name: row.name,
        createdBy: row.createdBy,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        lastActiveAt: row.lastActiveAt === null ? null : new Date(row.lastActiveAt),
      })
      .onConflictDoNothing({
        target: [computers.workspaceId, computers.ownerType, computers.ownerId],
      })
      .returning()
    if (inserted) return mapComputerRow(inserted)
    // The (workspace, ownerType, ownerId) binding is unique: a conflicting
    // insert means the owner already has a computer — return it.
    const existing = await this.findByOwner(row.workspaceId, row.ownerType, row.ownerId)
    if (!existing) throw new Error('Failed to create computer')
    return existing
  }

  async get(id: string): Promise<Computer | null> {
    const [row] = await this.db
      .select()
      .from(computers)
      .where(eq(computers.id, id))
      .limit(1)
    return row ? mapComputerRow(row) : null
  }

  async findByOwner(
    workspaceId: string,
    ownerType: ComputerOwnerType,
    ownerId: string,
  ): Promise<Computer | null> {
    const [row] = await this.db
      .select()
      .from(computers)
      .where(and(
        eq(computers.workspaceId, workspaceId),
        eq(computers.ownerType, ownerType),
        eq(computers.ownerId, ownerId),
      ))
      .limit(1)
    return row ? mapComputerRow(row) : null
  }

  async listByWorkspace(workspaceId: string): Promise<Computer[]> {
    const rows = await this.db
      .select()
      .from(computers)
      .where(eq(computers.workspaceId, workspaceId))
      .orderBy(asc(computers.createdAt))
    return rows.map(mapComputerRow)
  }

  async update(id: string, patch: Partial<Computer>): Promise<Computer> {
    const [row] = await this.db
      .update(computers)
      .set({
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.providerRef !== undefined ? { providerRef: patch.providerRef } : {}),
        ...(patch.size !== undefined ? { size: patch.size } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        updatedAt: patch.updatedAt !== undefined ? new Date(patch.updatedAt) : new Date(),
        ...(patch.lastActiveAt !== undefined
          ? { lastActiveAt: patch.lastActiveAt === null ? null : new Date(patch.lastActiveAt) }
          : {}),
      })
      .where(eq(computers.id, id))
      .returning()
    if (!row) throw new Error('Failed to update computer')
    return mapComputerRow(row)
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(computers).where(eq(computers.id, id))
  }
}

function mapComputerRow(row: ComputerRow): Computer {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerType: row.ownerType as Computer['ownerType'],
    ownerId: row.ownerId,
    provider: row.provider,
    providerRef: row.providerRef,
    size: row.size as Computer['size'],
    status: row.status as Computer['status'],
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastActiveAt: row.lastActiveAt?.getTime() ?? null,
  }
}
