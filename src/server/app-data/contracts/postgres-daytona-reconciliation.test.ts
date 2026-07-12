import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { durableJobs, users } from '@/server/database/postgres/schema'
import {
  DAYTONA_RECONCILE_JOB,
  PostgresDaytonaReconciliationService,
  type DaytonaReconcileSandbox,
} from '@/server/ai/sandbox/PostgresDaytonaReconciliationService'
import { PostgresDaytonaWorkspaceRepository } from '@/server/ai/sandbox/PostgresDaytonaWorkspaceRepository'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'
import { parseOverlayRuntimeConfig } from '@/shared/config'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test(
  'Postgres Daytona reconciliation and worker replacement recovery',
  { skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required' },
  async (t) => {
    if (!connectionString) return
    const pool = createOverlayPostgresPool({
      connectionString,
      max: 4,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    const db = createOverlayPostgresDb(pool)
    const repository = new PostgresDaytonaWorkspaceRepository(db)
    const userIds = [0, 1, 2].map(() => `p6_daytona_${randomUUID()}`)
    const now = Date.now()
    try {
      await db.delete(durableJobs).where(eq(durableJobs.type, DAYTONA_RECONCILE_JOB))
      await db.insert(users).values(userIds.map((id) => ({ email: `${id}@example.test`, id })))
      await repository.upsert(workspace(userIds[0]!, 'sandbox_existing', 'started', now - 60_000))
      await repository.upsert(workspace(userIds[2]!, 'sandbox_missing', 'stopped', now - 60_000))

      await t.test('adopts labeled workspaces, meters active windows, and marks missing state', async () => {
        const remote: DaytonaReconcileSandbox[] = [
          sandbox(userIds[0]!, 'sandbox_existing', 'started'),
          sandbox(userIds[1]!, 'sandbox_adopted', 'started'),
          { ...sandbox('', 'sandbox_unowned', 'started'), labels: {} },
        ]
        const service = new PostgresDaytonaReconciliationService({
          controlPlane: { listOverlayWorkspaces: async () => remote },
          now: () => now,
          repository,
        })
        const result = await service.reconcile()
        assert.deepEqual(result, {
          adopted: 1,
          errors: 1,
          metered: 1,
          missing: 1,
          scanned: 3,
          stale: 0,
          updated: 1,
        })
        assert.equal((await repository.getByUserId({ userId: userIds[0]! }))?.lastMeteredAt, now)
        assert.equal((await repository.getByUserId({ userId: userIds[1]! }))?.sandboxId, 'sandbox_adopted')
        assert.equal((await repository.getByUserId({ userId: userIds[2]! }))?.state, 'missing')
      })

      await t.test('an expired worker lease is recovered by a replacement worker', async () => {
        let reconcileCalls = 0
        const runtimeConfig = parseOverlayRuntimeConfig({
          ...DEFAULT_OVERLAY_RUNTIME_CONFIG,
          app: {
            ...DEFAULT_OVERLAY_RUNTIME_CONFIG.app,
            baseUrl: 'https://overlay.example.test',
            deploymentEnvironment: 'staging',
          },
          providers: {
            ...DEFAULT_OVERLAY_RUNTIME_CONFIG.providers,
            sandbox: { provider: 'daytona' },
          },
        })
        const runtime = createPostgresRuntime({
          daytonaReconciler: {
            reconcile: async () => {
              reconcileCalls += 1
              return { ok: true } as never
            },
          },
          db,
          leaseMs: 1_000,
          runtimeConfig,
          workerId: `replacement-${randomUUID()}`,
        })
        const jobId = await runtime.jobs.enqueue({
          dedupeKey: `p6-daytona-recovery-${randomUUID()}`,
          maxAttempts: 3,
          type: DAYTONA_RECONCILE_JOB,
        })
        const claimAt = Date.now() + 100
        const crashed = await runtime.jobs.claim({
          leaseMs: 1_000,
          now: claimAt,
          workerId: 'crashed-worker',
        })
        assert.equal(crashed?.id, jobId)
        assert.equal(await runtime.worker.runOnce(claimAt + 1_001), 'succeeded')
        assert.equal(reconcileCalls, 1)
        const [job] = await db.select().from(durableJobs).where(eq(durableJobs.id, jobId))
        assert.equal(job?.status, 'succeeded')
        assert.equal(job?.attempts, 2)
      })
    } finally {
      for (const userId of userIds) await db.delete(users).where(eq(users.id, userId))
      await db.delete(durableJobs).where(eq(durableJobs.type, DAYTONA_RECONCILE_JOB))
      await pool.end()
    }
  },
)

function workspace(
  userId: string,
  sandboxId: string,
  state: 'started' | 'stopped',
  lastMeteredAt: number,
) {
  return {
    lastKnownStartedAt: state === 'started' ? lastMeteredAt : undefined,
    lastKnownStoppedAt: state === 'stopped' ? lastMeteredAt : undefined,
    lastMeteredAt,
    mountPath: '/home/daytona/workspace',
    resourceProfile: 'pro' as const,
    sandboxId,
    sandboxName: sandboxId,
    state,
    tier: 'pro' as const,
    userId,
    volumeId: `volume_${sandboxId}`,
    volumeName: `volume_${sandboxId}`,
  }
}

function sandbox(userId: string, id: string, state: string): DaytonaReconcileSandbox {
  return {
    cpu: 2,
    disk: 10,
    id,
    labels: {
      overlay: 'true',
      'overlay.kind': 'workspace',
      'overlay.tier': 'pro',
      'overlay.userId': userId,
    },
    memory: 4,
    name: id,
    state,
    updatedAt: new Date(),
    volumes: [{
      mountPath: '/home/daytona/workspace',
      volumeId: `volume_${id}`,
      volumeName: `volume_${id}`,
    }],
  }
}
