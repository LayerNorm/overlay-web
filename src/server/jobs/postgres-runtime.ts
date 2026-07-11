import 'server-only'

import type { ObjectStore } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { PostgresBackgroundMaintenanceService } from '@/server/app-data/PostgresBackgroundMaintenanceService'
import { PostgresIdempotencyRepository } from '@/server/idempotency'
import { PostgresServiceAuthReplayRepository } from '@/server/auth/replay'
import { PostgresModelCatalogRepository } from '@/server/ai/catalog'
import { getGatewayCatalog } from '@/server/ai/gateway/gateway-catalog'
import { PostgresDurableJobRepository } from './PostgresDurableJobRepository'
import { PostgresJobWorker } from './PostgresJobWorker'
import { PostgresSchedulerService } from './PostgresSchedulerService'
import {
  createStorageDeleteJobHandler,
  STORAGE_DELETE_OBJECTS_JOB,
} from '@/server/storage/PostgresStorageCleanupJobs'
import { PostgresStorageReconciliationService } from '@/server/storage/PostgresStorageReconciliationService'
import { PostgresOutputRetentionService } from '@/server/outputs/PostgresOutputRetentionService'

export function createPostgresRuntime(args: {
  db: OverlayPostgresDb
  leaseMs: number
  objectStore?: Pick<ObjectStore, 'deleteObject' | 'listObjects'>
  workerId: string
}) {
  const jobs = new PostgresDurableJobRepository(args.db)
  const idempotency = new PostgresIdempotencyRepository(args.db)
  const replay = new PostgresServiceAuthReplayRepository(args.db)
  const maintenance = new PostgresBackgroundMaintenanceService(args.db)
  const modelCatalog = new PostgresModelCatalogRepository(args.db)
  const scheduler = new PostgresSchedulerService(args.db)
  const storageReconciliation = args.objectStore
    ? new PostgresStorageReconciliationService(args.db, args.objectStore)
    : null
  const outputRetention = new PostgresOutputRetentionService(args.db)
  const worker = new PostgresJobWorker({
    handlers: {
      'runtime.healthcheck': async (job) => ({
        checkedAt: Date.now(),
        requestedBy: job.payload.requestedBy ?? 'unknown',
      }),
      'app-data.maintenance': async () => await maintenance.runAll(),
      'coordination.cleanup': async () => {
        const [expiredIdempotencyKeys, expiredReplayNonces] = await Promise.all([
          idempotency.cleanupExpired(),
          replay.cleanupExpired(),
        ])
        return { expiredIdempotencyKeys, expiredReplayNonces }
      },
      'model-catalog.refresh': async () => ({
        modelCount: (await getGatewayCatalog(true, modelCatalog)).length,
      }),
      'outputs.purge-expired': async () => await outputRetention.purgeExpired(),
      ...(args.objectStore
        ? {
            [STORAGE_DELETE_OBJECTS_JOB]: createStorageDeleteJobHandler(args.objectStore),
            'storage.reconcile': async () => await storageReconciliation!.run(),
          }
        : {}),
    },
    leaseMs: args.leaseMs,
    repository: jobs,
    workerId: args.workerId,
  })

  return { jobs, scheduler, worker }
}
