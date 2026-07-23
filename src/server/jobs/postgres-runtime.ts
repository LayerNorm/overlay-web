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
import {
  isPostgresKnowledgeRuntimeEnabled,
  postgresRuntimeSchedulesForConfig,
  PostgresSchedulerService,
} from './PostgresSchedulerService'
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
import { PostgresKnowledgeMaintenanceService } from '@/server/knowledge/PostgresKnowledgeMaintenanceService'
import {
  MEMORY_EXTRACT_TURN_JOB,
  MemoryExtractionService,
  PostgresMemoryExtractionRepository,
  PostgresMemoryRepository,
  createMemoryExtractionProvider,
  type MemoryExtractionProvider,
} from '@/server/memory'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type { OverlayRuntimeConfig } from '@/shared/config'
import {
  DAYTONA_RECONCILE_JOB,
  DaytonaSdkReconciliationControlPlane,
  PostgresDaytonaReconciliationService,
} from '@/server/ai/sandbox/PostgresDaytonaReconciliationService'
import { PostgresDaytonaWorkspaceRepository } from '@/server/ai/sandbox/PostgresDaytonaWorkspaceRepository'
import {
  PostgresWebhookDeliveryService,
  WEBHOOK_DELIVERY_JOB,
} from '@/server/webhooks'
import {
  AUTOMATION_EXECUTE_JOB,
  AUTOMATION_SCHEDULE_DUE_JOB,
  PostgresAutomationRunCoordinator,
} from '@/server/automations/PostgresAutomationRunCoordinator'
import {
  runActTurnForScheduledAutomation,
  type ScheduledAutomationTurn,
} from '@/server/agent/run-act-turn'
import { PostgresUsageRepository } from '@/server/usage'
import type { AuthorizationService } from '@/server/authorization'
import { authorizeDurableJob } from './DurableJobAuthorization'
import {
  CANONICAL_KNOWLEDGE_INDEX_JOB,
  PostgresCanonicalKnowledgeIndexService,
} from '@/server/knowledge-bases/PostgresCanonicalKnowledgeIndex'

export function createPostgresRuntime(args: {
  db: OverlayPostgresDb
  leaseMs: number
  automationExecutor?: (input: ScheduledAutomationTurn) => Promise<{ conversationId: string }>
  authorizationService?: AuthorizationService
  daytonaReconciler?: Pick<PostgresDaytonaReconciliationService, 'reconcile'>
  embeddingProvider?: EmbeddingProvider
  memoryExtractionProvider?: MemoryExtractionProvider
  objectStore?: Pick<ObjectStore, 'deleteObject' | 'listObjects'>
  runtimeConfig?: OverlayRuntimeConfig
  workerId: string
}) {
  const jobs = new PostgresDurableJobRepository(args.db)
  const idempotency = new PostgresIdempotencyRepository(args.db)
  const replay = new PostgresServiceAuthReplayRepository(args.db)
  const maintenance = new PostgresBackgroundMaintenanceService(args.db)
  const modelCatalog = new PostgresModelCatalogRepository(args.db)
  const scheduler = new PostgresSchedulerService(
    args.db,
    args.runtimeConfig ? postgresRuntimeSchedulesForConfig(args.runtimeConfig) : undefined,
  )
  const automationRuns = new PostgresAutomationRunCoordinator(args.db)
  const automationExecutor = args.automationExecutor ?? runActTurnForScheduledAutomation
  const webhookDeliveries = new PostgresWebhookDeliveryService(args.db)
  const usage = new PostgresUsageRepository(args.db)
  let daytonaReconciler = args.daytonaReconciler
  const getDaytonaReconciler = () => {
    daytonaReconciler ??= new PostgresDaytonaReconciliationService({
      controlPlane: new DaytonaSdkReconciliationControlPlane(),
      repository: new PostgresDaytonaWorkspaceRepository(args.db),
    })
    return daytonaReconciler
  }
  const storageReconciliation = args.objectStore
    ? new PostgresStorageReconciliationService(args.db, args.objectStore)
    : null
  const outputRetention = new PostgresOutputRetentionService(args.db)
  const knowledgeMaintenance = new PostgresKnowledgeMaintenanceService(args.db)
  const runtimeConfig = () => args.runtimeConfig ?? getOverlayRuntimeConfigSync()
  let knowledgeIndex: KnowledgeIndexService | null = null
  const getKnowledgeIndex = () => {
    knowledgeIndex ??= new KnowledgeIndexService({
      embeddings: args.embeddingProvider ?? createEmbeddingProvider(runtimeConfig()),
      repository: new PostgresKnowledgeIndexRepository(args.db),
    })
    return knowledgeIndex
  }
  let canonicalKnowledgeIndex: PostgresCanonicalKnowledgeIndexService | null = null
  const getCanonicalKnowledgeIndex = () => {
    canonicalKnowledgeIndex ??= new PostgresCanonicalKnowledgeIndexService({
      db: args.db,
      embeddings: args.embeddingProvider ?? createEmbeddingProvider(runtimeConfig()),
    })
    return canonicalKnowledgeIndex
  }
  let memoryExtraction: MemoryExtractionService | null = null
  const getMemoryExtraction = () => {
    memoryExtraction ??= new MemoryExtractionService({
      extractor: args.memoryExtractionProvider ?? createMemoryExtractionProvider(runtimeConfig()),
      memories: new PostgresMemoryRepository(args.db),
      runs: new PostgresMemoryExtractionRepository(args.db),
    })
    return memoryExtraction
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
      'usage.reconcile': async () => await usage.reconcileExpired(),
      'model-catalog.refresh': async () => ({
        modelCount: (await getGatewayCatalog(true, modelCatalog)).length,
      }),
      'outputs.purge-expired': async () => await outputRetention.purgeExpired(),
      [AUTOMATION_SCHEDULE_DUE_JOB]: async () => await automationRuns.enqueueDueRuns(),
      [AUTOMATION_EXECUTE_JOB]: async (job) => {
        const runId = requiredStringPayload(job.payload.runId, 'runId')
        const authorization = await requireUserJobAuthorization(job, args.authorizationService)
        if (!authorization.allowed) {
          await automationRuns.denyRunForAuthorization({
            error: authorizationError(authorization),
            runId,
          })
          return { runId, status: 'authorization_denied' }
        }
        const started = await automationRuns.startAttempt({
          attemptNumber: job.attempts,
          jobId: job.id,
          runId,
          workerId: args.workerId,
        })
        if (started !== 'started') return { runId, status: started }
        try {
          const input = await automationRuns.getExecutionInput(runId)
          if (!input) throw new Error(`Automation run ${runId} is not executable`)
          const result = await automationExecutor(input)
          await automationRuns.completeAttempt({
            attemptNumber: job.attempts,
            conversationId: result.conversationId,
            result,
            runId,
          })
          return { ...result, runId, status: 'succeeded' }
        } catch (error) {
          await automationRuns.failAttempt({
            attemptNumber: job.attempts,
            error: error instanceof Error ? error.stack ?? error.message : String(error),
            runId,
            terminal: job.attempts >= job.maxAttempts,
          })
          throw error
        }
      },
      [WEBHOOK_DELIVERY_JOB]: async (job) => {
        const deliveryId = requiredStringPayload(job.payload.deliveryId, 'deliveryId')
        const authorization = await requireUserJobAuthorization(job, args.authorizationService)
        if (!authorization.allowed) {
          await webhookDeliveries.denyForAuthorization({
            deliveryId,
            error: authorizationError(authorization),
          })
          return { deliveryId, status: 'authorization_denied' }
        }
        return await webhookDeliveries.deliver(job)
      },
      [DAYTONA_RECONCILE_JOB]: async () => {
        const config = runtimeConfig()
        if (!config.features.sandboxes || config.providers.sandbox?.provider !== 'daytona') {
          return { skipped: 'daytona_disabled' }
        }
        return await getDaytonaReconciler().reconcile()
      },
      [KNOWLEDGE_REINDEX_JOB]: async (job) => {
        const authorization = await requireUserJobAuthorization(job, args.authorizationService)
        if (!authorization.allowed) return { status: 'authorization_denied' }
        return await getKnowledgeIndex().reindex({
          expectedContentHash: stringPayload(job.payload.contentHash),
          sourceId: requiredStringPayload(job.payload.sourceId, 'sourceId'),
          sourceKind: sourceKindPayload(job.payload.sourceKind),
          userId: requiredStringPayload(job.payload.userId, 'userId'),
        })
      },
      [CANONICAL_KNOWLEDGE_INDEX_JOB]: async (job) => {
        const authorization = await requireUserJobAuthorization(job, args.authorizationService)
        if (!authorization.allowed) return { status: 'authorization_denied' }
        return await getCanonicalKnowledgeIndex().index({
          contentHash: requiredStringPayload(job.payload.contentHash, 'contentHash'),
          sourceId: requiredStringPayload(job.payload.sourceId, 'sourceId'),
          sourceVersionId: requiredStringPayload(job.payload.sourceVersionId, 'sourceVersionId'),
          userId: requiredStringPayload(job.payload.userId, 'userId'),
        })
      },
      [MEMORY_EXTRACT_TURN_JOB]: async (job) => {
        const authorization = await requireUserJobAuthorization(job, args.authorizationService)
        if (!authorization.allowed) return { status: 'authorization_denied' }
        return await getMemoryExtraction().extractTurn({
          conversationId: requiredStringPayload(job.payload.conversationId, 'conversationId'),
          messageId: requiredStringPayload(job.payload.messageId, 'messageId'),
          turnId: requiredStringPayload(job.payload.turnId, 'turnId'),
          userId: requiredStringPayload(job.payload.userId, 'userId'),
        })
      },
      'knowledge.maintenance': async () => {
        const config = runtimeConfig()
        if (!isPostgresKnowledgeRuntimeEnabled(config)) {
          return { skipped: 'knowledge_disabled' }
        }
        const embeddings = args.embeddingProvider ?? createEmbeddingProvider(config)
        return await knowledgeMaintenance.runAll({
          memoryRetentionDays: config.compliance.retention.memoryDays,
          modelVersion: embeddings.identity.modelVersion,
        })
      },
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

  return { automationRuns, jobs, scheduler, worker }
}

async function requireUserJobAuthorization(
  job: Parameters<typeof authorizeDurableJob>[0]['job'],
  authorizationService?: AuthorizationService,
) {
  if (!authorizationService) {
    return { allowed: true, deniedCapabilities: [] }
  }
  return await authorizeDurableJob({ authorization: authorizationService, job })
}

function authorizationError(result: Awaited<ReturnType<typeof requireUserJobAuthorization>>): string {
  return result.reason === 'authorization_metadata_missing'
    ? 'Durable job authorization metadata is missing'
    : `Authorization revoked before execution: ${result.deniedCapabilities.join(', ')}`
}

function stringPayload(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredStringPayload(value: unknown, name: string): string {
  const result = stringPayload(value)
  if (!result) throw new Error(`Durable job requires ${name}`)
  return result
}

function sourceKindPayload(value: unknown): 'file' | 'memory' {
  if (value === 'file' || value === 'memory') return value
  throw new Error('Knowledge reindex job requires sourceKind=file|memory')
}
