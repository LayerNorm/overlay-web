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
import {
  KNOWLEDGE_REINDEX_JOB,
  KnowledgeIndexService,
  PostgresKnowledgeIndexRepository,
  createEmbeddingProvider,
  type EmbeddingProvider,
} from '@/server/knowledge'
import { getOverlayRuntimeConfigSync } from '@/server/config'

export function createPostgresRuntime(args: {
  db: OverlayPostgresDb
  leaseMs: number
  embeddingProvider?: EmbeddingProvider
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
  let knowledgeIndex: KnowledgeIndexService | null = null
  const getKnowledgeIndex = () => {
    knowledgeIndex ??= new KnowledgeIndexService({
      embeddings: args.embeddingProvider ?? createEmbeddingProvider(getOverlayRuntimeConfigSync()),
      repository: new PostgresKnowledgeIndexRepository(args.db),
    })
    return knowledgeIndex
  }
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
      [KNOWLEDGE_REINDEX_JOB]: async (job) => await getKnowledgeIndex().reindex({
        expectedContentHash: stringPayload(job.payload.contentHash),
        sourceId: requiredStringPayload(job.payload.sourceId, 'sourceId'),
        sourceKind: sourceKindPayload(job.payload.sourceKind),
        userId: requiredStringPayload(job.payload.userId, 'userId'),
      }),
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

function stringPayload(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredStringPayload(value: unknown, name: string): string {
  const result = stringPayload(value)
  if (!result) throw new Error(`Knowledge reindex job requires ${name}`)
  return result
}

function sourceKindPayload(value: unknown): 'file' | 'memory' {
  if (value === 'file' || value === 'memory') return value
  throw new Error('Knowledge reindex job requires sourceKind=file|memory')
}
