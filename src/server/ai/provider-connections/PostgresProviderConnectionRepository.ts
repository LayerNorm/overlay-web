import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { providerConnections } from '@/server/database/postgres/schema'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import type {
  CreateProviderConnectionInput,
  ProviderConnectionRecord,
  ProviderConnectionRepository,
  UpdateProviderConnectionInput,
} from './ProviderConnectionRepository'

type ProviderConnectionDbRow = typeof providerConnections.$inferSelect

export class PostgresProviderConnectionRepository implements ProviderConnectionRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async count(args: { userId: string }): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(providerConnections)
      .where(eq(providerConnections.userId, args.userId))
    return row?.count ?? 0
  }

  async listPublic(args: { userId: string }): Promise<ByokConnectionRow[]> {
    const rows = await this.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.userId, args.userId))
      .orderBy(asc(providerConnections.createdAt))
    return rows.map(toPublicRow)
  }

  async get(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null> {
    const [row] = await this.db
      .select()
      .from(providerConnections)
      .where(and(
        eq(providerConnections.id, args.connectionId),
        eq(providerConnections.userId, args.userId),
      ))
      .limit(1)
    return row ? toRecord(row) : null
  }

  async create(args: CreateProviderConnectionInput): Promise<string> {
    const id = `byok_${randomUUID().replaceAll('-', '')}`
    await this.db.insert(providerConnections).values({
      id,
      userId: args.userId,
      providerId: args.providerId,
      endpoint: args.endpoint,
      displayName: args.displayName,
      credentialRef: args.credentialRef,
      enabledModelIds: args.enabledModelIds,
      status: 'untested',
      isDefault: args.isDefault,
      isDeletable: args.isDeletable,
    })
    return id
  }

  async update(args: UpdateProviderConnectionInput): Promise<void> {
    const rows = await this.db
      .update(providerConnections)
      .set({
        ...(args.displayName !== undefined ? { displayName: args.displayName } : {}),
        ...(args.endpoint !== undefined ? { endpoint: args.endpoint } : {}),
        ...(args.credentialRef !== undefined ? { credentialRef: args.credentialRef } : {}),
        ...(args.enabledModelIds !== undefined ? { enabledModelIds: args.enabledModelIds } : {}),
        ...(args.discoveredModelsJson !== undefined ? { discoveredModelsJson: args.discoveredModelsJson } : {}),
        ...(args.discoveredAt !== undefined ? { discoveredAt: new Date(args.discoveredAt) } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
        ...(args.lastTestedAt !== undefined ? { lastTestedAt: new Date(args.lastTestedAt) } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(providerConnections.id, args.connectionId),
        eq(providerConnections.userId, args.userId),
      ))
      .returning({ id: providerConnections.id })
    if (rows.length === 0) throw new Error('Connection not found')
  }

  async remove(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null> {
    const [row] = await this.db
      .delete(providerConnections)
      .where(and(
        eq(providerConnections.id, args.connectionId),
        eq(providerConnections.userId, args.userId),
        eq(providerConnections.isDeletable, true),
      ))
      .returning()
    return row ? toRecord(row) : null
  }

  async ensureDefaultGateway(args: {
    userId: string
    endpoint: string
    displayName: string
    enabledModelIds: string[]
    discoveredModelsJson?: string
    discoveredAt?: number
  }): Promise<ByokConnectionRow> {
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(providerConnections)
        .where(and(
          eq(providerConnections.userId, args.userId),
          eq(providerConnections.providerId, 'vercel-ai-gateway'),
          eq(providerConnections.isDefault, true),
        ))
        .limit(1)

      if (existing) {
        const [updated] = await tx
          .update(providerConnections)
          .set({
            endpoint: args.endpoint,
            displayName: args.displayName,
            isDefault: true,
            isDeletable: false,
            ...(existing.enabledModelIds.length === 0 && args.enabledModelIds.length > 0
              ? { enabledModelIds: args.enabledModelIds }
              : {}),
            ...(!existing.discoveredModelsJson && args.discoveredModelsJson
              ? { discoveredModelsJson: args.discoveredModelsJson }
              : {}),
            ...(!existing.discoveredAt && args.discoveredAt
              ? { discoveredAt: new Date(args.discoveredAt) }
              : {}),
            ...(existing.status !== 'active' ? { status: 'active' as const } : {}),
            updatedAt: new Date(),
          })
          .where(eq(providerConnections.id, existing.id))
          .returning()
        if (!updated) throw new Error('Connection not found after update')
        return toPublicRow(updated)
      }

      const id = `byok_${randomUUID().replaceAll('-', '')}`
      const [created] = await tx
        .insert(providerConnections)
        .values({
          id,
          userId: args.userId,
          providerId: 'vercel-ai-gateway',
          endpoint: args.endpoint,
          displayName: args.displayName,
          enabledModelIds: args.enabledModelIds,
          discoveredModelsJson: args.discoveredModelsJson,
          discoveredAt: args.discoveredAt ? new Date(args.discoveredAt) : undefined,
          status: 'active',
          isDefault: true,
          isDeletable: false,
        })
        .returning()
      if (!created) throw new Error('Connection not found after create')
      return toPublicRow(created)
    })
  }

  async listCredentialRefs(args: { userId: string }): Promise<string[]> {
    const rows = await this.db
      .select({ credentialRef: providerConnections.credentialRef })
      .from(providerConnections)
      .where(eq(providerConnections.userId, args.userId))
    return rows.flatMap((row) => row.credentialRef ? [row.credentialRef] : [])
  }
}

function toPublicRow(row: ProviderConnectionDbRow): ByokConnectionRow {
  return {
    _id: row.id,
    providerId: row.providerId,
    endpoint: row.endpoint,
    displayName: row.displayName,
    enabledModelIds: row.enabledModelIds,
    discoveredModelsJson: row.discoveredModelsJson ?? undefined,
    discoveredAt: row.discoveredAt?.getTime(),
    status: row.status,
    lastError: row.lastError ?? undefined,
    lastTestedAt: row.lastTestedAt?.getTime(),
    isDefault: row.isDefault,
    isDeletable: row.isDeletable,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function toRecord(row: ProviderConnectionDbRow): ProviderConnectionRecord {
  return {
    ...toPublicRow(row),
    userId: row.userId,
    credentialRef: row.credentialRef ?? undefined,
  }
}
