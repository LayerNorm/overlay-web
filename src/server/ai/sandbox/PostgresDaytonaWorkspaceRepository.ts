import 'server-only'

import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { daytonaWorkspaces } from '@/server/database/postgres/schema'
import { computeDaytonaRuntimeCost } from './daytona-pricing'
import type {
  DaytonaUsageAccrual,
  DaytonaWorkspaceRecord,
  DaytonaWorkspaceRepository,
  DaytonaWorkspaceUpsert,
} from './DaytonaWorkspaceRepository'

export class PostgresDaytonaWorkspaceRepository implements DaytonaWorkspaceRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getByUserId(args: { userId: string }): Promise<DaytonaWorkspaceRecord | null> {
    const [row] = await this.db
      .select()
      .from(daytonaWorkspaces)
      .where(eq(daytonaWorkspaces.userId, args.userId))
      .limit(1)
    return row ? normalize(row) : null
  }

  async upsert(args: DaytonaWorkspaceUpsert): Promise<DaytonaWorkspaceRecord> {
    const now = new Date()
    const [row] = await this.db
      .insert(daytonaWorkspaces)
      .values({
        ...args,
        lastMeteredAt: date(args.lastMeteredAt),
        lastKnownStartedAt: date(args.lastKnownStartedAt),
        lastKnownStoppedAt: date(args.lastKnownStoppedAt),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: daytonaWorkspaces.userId,
        set: {
          sandboxId: args.sandboxId,
          sandboxName: args.sandboxName,
          volumeId: args.volumeId,
          volumeName: args.volumeName,
          tier: args.tier,
          state: args.state,
          resourceProfile: args.resourceProfile,
          mountPath: args.mountPath,
          lastMeteredAt: date(args.lastMeteredAt),
          lastKnownStartedAt: date(args.lastKnownStartedAt),
          lastKnownStoppedAt: date(args.lastKnownStoppedAt),
          updatedAt: now,
        },
      })
      .returning()
    if (!row) throw new Error('Failed to upsert Daytona workspace record.')
    return normalize(row)
  }

  async accrueUsage(args: DaytonaUsageAccrual) {
    return await this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select()
        .from(daytonaWorkspaces)
        .where(eq(daytonaWorkspaces.userId, args.userId))
        .for('update')
        .limit(1)
      if (!workspace || workspace.sandboxId !== args.sandboxId) {
        return { success: false as const, skipped: 'missing_workspace' as const }
      }
      const expected = args.expectedLastMeteredAt
      if (expected !== undefined && workspace.lastMeteredAt?.getTime() !== expected) {
        return { success: false as const, skipped: 'stale_meter_window' as const }
      }
      const startedAt = Math.max(args.startedAt, workspace.lastMeteredAt?.getTime() ?? args.startedAt)
      const endedAt = Math.max(startedAt, args.endedAt)
      const durationSeconds = Math.max(0, (endedAt - startedAt) / 1000)
      const cost = computeDaytonaRuntimeCost({
        cpu: args.cpu,
        memoryGiB: args.memoryGiB,
        diskGiB: args.diskGiB,
        elapsedSeconds: durationSeconds,
      })
      await tx
        .update(daytonaWorkspaces)
        .set({ lastMeteredAt: new Date(endedAt), updatedAt: new Date() })
        .where(eq(daytonaWorkspaces.userId, args.userId))
      return {
        success: true as const,
        durationSeconds,
        costUsd: cost.costUsd,
        costCents: Math.round(cost.costUsd * 100),
      }
    })
  }
}

type Row = typeof daytonaWorkspaces.$inferSelect

function normalize(row: Row): DaytonaWorkspaceRecord {
  return {
    _id: row.userId,
    userId: row.userId,
    sandboxId: row.sandboxId,
    sandboxName: row.sandboxName,
    volumeId: row.volumeId,
    volumeName: row.volumeName,
    tier: row.tier as DaytonaWorkspaceRecord['tier'],
    state: row.state as DaytonaWorkspaceRecord['state'],
    resourceProfile: row.resourceProfile as DaytonaWorkspaceRecord['resourceProfile'],
    mountPath: row.mountPath,
    lastMeteredAt: row.lastMeteredAt?.getTime(),
    lastKnownStartedAt: row.lastKnownStartedAt?.getTime(),
    lastKnownStoppedAt: row.lastKnownStoppedAt?.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function date(value: number | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value)
}
