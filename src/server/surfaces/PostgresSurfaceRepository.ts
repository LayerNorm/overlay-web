import 'server-only'

import { and, asc, eq } from 'drizzle-orm'
import type { SurfaceBinding, SurfaceConnection, SurfacePlatform } from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { surfaceBindings, surfaceConnections } from '@/server/database/postgres/schema'
import type { SurfaceRepository } from './SurfaceRepository'

type ConnectionRow = typeof surfaceConnections.$inferSelect
type BindingRow = typeof surfaceBindings.$inferSelect

export class PostgresSurfaceRepository implements SurfaceRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async upsertConnection(row: SurfaceConnection): Promise<SurfaceConnection> {
    const [upserted] = await this.db
      .insert(surfaceConnections)
      .values({
        id: row.id,
        workspaceId: row.workspaceId,
        platform: row.platform,
        externalTeamId: row.externalTeamId,
        externalTeamName: row.externalTeamName,
        externalEnterpriseId: row.externalEnterpriseId,
        botUserId: row.botUserId,
        status: row.status,
        installedByUserId: row.installedByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      })
      .onConflictDoUpdate({
        target: [surfaceConnections.platform, surfaceConnections.externalTeamId],
        // Reinstall refreshes metadata only — never workspaceId, so a second
        // Overlay workspace cannot steal a connected Slack team.
        set: {
          externalTeamName: row.externalTeamName,
          externalEnterpriseId: row.externalEnterpriseId,
          botUserId: row.botUserId,
          status: row.status,
          updatedAt: new Date(row.updatedAt),
        },
      })
      .returning()
    if (!upserted) throw new Error('Failed to upsert surface connection')
    return mapConnectionRow(upserted)
  }

  async getConnection(id: string): Promise<SurfaceConnection | null> {
    const [row] = await this.db
      .select()
      .from(surfaceConnections)
      .where(eq(surfaceConnections.id, id))
      .limit(1)
    return row ? mapConnectionRow(row) : null
  }

  async findConnectionByTeam(
    platform: SurfacePlatform,
    externalTeamId: string,
  ): Promise<SurfaceConnection | null> {
    const [row] = await this.db
      .select()
      .from(surfaceConnections)
      .where(and(
        eq(surfaceConnections.platform, platform),
        eq(surfaceConnections.externalTeamId, externalTeamId),
      ))
      .limit(1)
    return row ? mapConnectionRow(row) : null
  }

  async listConnections(workspaceId: string): Promise<SurfaceConnection[]> {
    const rows = await this.db
      .select()
      .from(surfaceConnections)
      .where(eq(surfaceConnections.workspaceId, workspaceId))
      .orderBy(asc(surfaceConnections.createdAt))
    return rows.map(mapConnectionRow)
  }

  async updateConnection(id: string, patch: Partial<SurfaceConnection>): Promise<SurfaceConnection> {
    const [row] = await this.db
      .update(surfaceConnections)
      .set({
        ...(patch.externalTeamName !== undefined ? { externalTeamName: patch.externalTeamName } : {}),
        ...(patch.externalEnterpriseId !== undefined ? { externalEnterpriseId: patch.externalEnterpriseId } : {}),
        ...(patch.botUserId !== undefined ? { botUserId: patch.botUserId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: patch.updatedAt !== undefined ? new Date(patch.updatedAt) : new Date(),
      })
      .where(eq(surfaceConnections.id, id))
      .returning()
    if (!row) throw new Error('Failed to update surface connection')
    return mapConnectionRow(row)
  }

  async createBinding(row: SurfaceBinding): Promise<SurfaceBinding> {
    const [inserted] = await this.db
      .insert(surfaceBindings)
      .values({
        id: row.id,
        connectionId: row.connectionId,
        agentId: row.agentId,
        channelId: row.channelId,
        channelName: row.channelName,
        status: row.status,
        createdByUserId: row.createdByUserId,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      })
      .onConflictDoNothing({
        target: [surfaceBindings.connectionId, surfaceBindings.channelId],
      })
      .returning()
    if (inserted) return mapBindingRow(inserted)
    // (connectionId, channelId) is unique: a hit means the channel already has
    // a binding row. Reactivate only when it was previously removed — an active
    // binding is returned unchanged, matching the Convex implementation.
    const existing = await this.findBindingByChannel(row.connectionId, row.channelId)
    if (!existing) throw new Error('Failed to create surface binding')
    if (existing.status === 'removed') {
      return await this.updateBinding(existing.id, {
        agentId: row.agentId,
        channelName: row.channelName,
        status: row.status,
        createdByUserId: row.createdByUserId,
        updatedAt: row.updatedAt,
      })
    }
    return existing
  }

  async getBinding(id: string): Promise<SurfaceBinding | null> {
    const [row] = await this.db
      .select()
      .from(surfaceBindings)
      .where(eq(surfaceBindings.id, id))
      .limit(1)
    return row ? mapBindingRow(row) : null
  }

  async findBindingByChannel(connectionId: string, channelId: string): Promise<SurfaceBinding | null> {
    const [row] = await this.db
      .select()
      .from(surfaceBindings)
      .where(and(
        eq(surfaceBindings.connectionId, connectionId),
        eq(surfaceBindings.channelId, channelId),
      ))
      .limit(1)
    return row ? mapBindingRow(row) : null
  }

  async listBindingsByAgent(agentId: string): Promise<SurfaceBinding[]> {
    const rows = await this.db
      .select()
      .from(surfaceBindings)
      .where(eq(surfaceBindings.agentId, agentId))
      .orderBy(asc(surfaceBindings.createdAt))
    return rows.map(mapBindingRow)
  }

  async listBindingsByConnection(connectionId: string): Promise<SurfaceBinding[]> {
    const rows = await this.db
      .select()
      .from(surfaceBindings)
      .where(eq(surfaceBindings.connectionId, connectionId))
      .orderBy(asc(surfaceBindings.createdAt))
    return rows.map(mapBindingRow)
  }

  async updateBinding(id: string, patch: Partial<SurfaceBinding>): Promise<SurfaceBinding> {
    const [row] = await this.db
      .update(surfaceBindings)
      .set({
        ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
        ...(patch.channelName !== undefined ? { channelName: patch.channelName } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.createdByUserId !== undefined ? { createdByUserId: patch.createdByUserId } : {}),
        updatedAt: patch.updatedAt !== undefined ? new Date(patch.updatedAt) : new Date(),
      })
      .where(eq(surfaceBindings.id, id))
      .returning()
    if (!row) throw new Error('Failed to update surface binding')
    return mapBindingRow(row)
  }
}

function mapConnectionRow(row: ConnectionRow): SurfaceConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform as SurfaceConnection['platform'],
    externalTeamId: row.externalTeamId,
    externalTeamName: row.externalTeamName,
    externalEnterpriseId: row.externalEnterpriseId,
    botUserId: row.botUserId,
    status: row.status as SurfaceConnection['status'],
    installedByUserId: row.installedByUserId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function mapBindingRow(row: BindingRow): SurfaceBinding {
  return {
    id: row.id,
    connectionId: row.connectionId,
    agentId: row.agentId,
    channelId: row.channelId,
    channelName: row.channelName,
    status: row.status as SurfaceBinding['status'],
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}
