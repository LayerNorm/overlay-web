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
import { BillingBackedActUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { BillingGenerationUsagePolicy } from '@/server/outputs/GenerationUsagePolicy'
import { PostgresConnectedAgentRepository } from '@/server/agents/PostgresConnectedAgentRepository'
import { ManagedAgentSandboxBilling } from '@/server/agents/ManagedAgentSandboxBilling'
import type { RemoteAgentUsageSettlement } from '@/server/agents/ConnectedAgentRepository'
import { logger } from '@/server/observability/logger'
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
import { ServerProviderUsageMeter } from '@/server/billing/ServerProviderUsageMeter'
import { AuditService, PostgresAuditRepository } from '@/server/admin'
import { createLazyEmailProvider } from '@/server/email/createLazyEmailProvider'
import { EmailOutboxDelivery } from '@/server/email/EmailOutboxDelivery'
import { PostgresEmailRecipientRepository } from '@/server/email/EmailRecipientRepository'
import { PostgresEmailSuppressionRepository } from '@/server/email/PostgresEmailSuppressionRepository'
import { PostgresOutboxRepository } from './PostgresOutboxRepository'
import { PostgresOutboxWorker } from './PostgresOutboxWorker'
import { sanitizeJobError } from './sanitize-job-error'

export function createPostgresRuntime(args: {
  db: OverlayPostgresDb
  leaseMs: number
  automationExecutor?: (input: ScheduledAutomationTurn) => Promise<{ conversationId: string }>
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
  const remoteAgentUsage = new BillingBackedActUsagePolicy({ repository: usage, accountAllUsage: true })
  const connectedAgents = new PostgresConnectedAgentRepository(args.db)
  const connectedAgentSandboxBilling = new ManagedAgentSandboxBilling({
    policy: new BillingGenerationUsagePolicy(usage),
    repository: connectedAgents,
  })
  const audit = new AuditService(new PostgresAuditRepository(args.db))
  const settleRemoteAgentUsage = async (settlement: RemoteAgentUsageSettlement) => {
    try {
      if (settlement.modelUsageBilling !== 'overlay') {
        if (settlement.reservationId) await remoteAgentUsage.releaseReservation({
          reservationId: settlement.reservationId, userId: settlement.userId, reason: 'remote_agent_byok',
        })
      } else if (settlement.outcome === 'cancelled') {
        await remoteAgentUsage.releaseReservation({ reservationId: settlement.reservationId,
          userId: settlement.userId, reason: 'remote_agent_cancelled' })
      } else if (settlement.outcome !== 'completed' && settlement.inputTokens === 0 && settlement.outputTokens === 0) {
        await remoteAgentUsage.markReservationForReconcile({ reservationId: settlement.reservationId,
          userId: settlement.userId, errorMessage: `remote_agent_${settlement.outcome}` })
      } else if (settlement.reservationId) {
        await remoteAgentUsage.recordFinishedUsage(settlement)
      }
    } finally {
      await connectedAgentSandboxBilling.settle(settlement)
    }
    await audit.record({
      action: 'agent_remote_run.usage_settled', actorType: 'service', outcome: 'success',
      resourceType: 'agent_run', resourceId: settlement.runId,
      metadata: { workspaceId: settlement.workspaceId, agentId: settlement.agentId,
        environmentId: settlement.environmentId, runId: settlement.runId,
        reservationId: settlement.reservationId,
        sandboxReservationId: settlement.sandboxBilling?.reservationId,
        sandboxProviderReference: settlement.sandboxBilling?.providerReference },
    })
  }
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
      usageMeter: new ServerProviderUsageMeter(usage),
    })
    return knowledgeIndex
  }
  let memoryExtraction: MemoryExtractionService | null = null
  const getMemoryExtraction = () => {
    memoryExtraction ??= new MemoryExtractionService({
      extractor: args.memoryExtractionProvider ?? createMemoryExtractionProvider(runtimeConfig()),
      memories: new PostgresMemoryRepository(args.db),
      runs: new PostgresMemoryExtractionRepository(args.db),
      usageMeter: new ServerProviderUsageMeter(usage),
    })
    return memoryExtraction
  }
  const worker = new PostgresJobWorker({
    handlers: {
      'runtime.healthcheck': async (job) => ({
        checkedAt: Date.now(),
        requestedBy: job.payload.requestedBy ?? 'unknown',
      }),
      'app-data.maintenance': async () => {
        const summary = await maintenance.runAll()
        for (const settlement of summary.remoteAgentRuns.settlements) {
          if (!settlement.userId) continue
          try {
            await settleRemoteAgentUsage(settlement)
          } catch (error) {
            logger.error('Connected-agent timeout settlement deferred', { runId: settlement.runId, error })
          }
        }
        const pendingSettlements = await connectedAgents.listPendingSandboxSettlements({ limit: 100 })
        let reconciledSandboxSettlements = 0
        for (const settlement of pendingSettlements) {
          try {
            await settleRemoteAgentUsage(settlement)
            reconciledSandboxSettlements += 1
          } catch (error) {
            logger.error('Connected-agent sandbox settlement retry deferred', { runId: settlement.runId, error })
          }
        }
        for (const alert of summary.remoteAgentRuns.alerts) {
          logger.warn('Connected-agent operational alert', alert)
          await audit.record({
            action: `agent_operations.${alert.code}`, actorType: 'service', outcome: 'failure',
            resourceType: alert.runId ? 'agent_run' : 'agent_environment',
            resourceId: alert.runId ?? alert.environmentId ?? alert.workspaceId,
            metadata: alert,
          })
        }
        const remoteAgentArtifacts = { deleted: 0, skipped: !args.objectStore }
        if (args.objectStore) {
          const artifacts = await connectedAgents.listArtifactsForCleanup({ now: Date.now(), limit: 100 })
          for (const artifact of artifacts) {
            await args.objectStore.deleteObject(artifact.objectKey)
            if (await connectedAgents.markArtifactDeleted({ artifactId: artifact.id, now: Date.now() })) {
              remoteAgentArtifacts.deleted += 1
            }
          }
        }
        return { ...summary, reconciledSandboxSettlements, remoteAgentArtifacts }
      },
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
            error: sanitizeJobError(error),
            runId,
            terminal: job.attempts >= job.maxAttempts,
          })
          throw error
        }
      },
      [WEBHOOK_DELIVERY_JOB]: async (job) => await webhookDeliveries.deliver(job),
      [DAYTONA_RECONCILE_JOB]: async () => {
        const config = runtimeConfig()
        if (!config.features.sandboxes || config.providers.sandbox?.provider !== 'daytona') {
          return { skipped: 'daytona_disabled' }
        }
        return await getDaytonaReconciler().reconcile()
      },
      [KNOWLEDGE_REINDEX_JOB]: async (job) => await getKnowledgeIndex().reindex({
        expectedContentHash: stringPayload(job.payload.contentHash),
        sourceId: requiredStringPayload(job.payload.sourceId, 'sourceId'),
        sourceKind: sourceKindPayload(job.payload.sourceKind),
        userId: requiredStringPayload(job.payload.userId, 'userId'),
      }),
      [MEMORY_EXTRACT_TURN_JOB]: async (job) => await getMemoryExtraction().extractTurn({
        billingActorUserId: stringPayload(job.payload.billingActorUserId),
        billingSpendSubjectId: stringPayload(job.payload.billingSpendSubjectId),
        conversationId: requiredStringPayload(job.payload.conversationId, 'conversationId'),
        messageId: requiredStringPayload(job.payload.messageId, 'messageId'),
        turnId: requiredStringPayload(job.payload.turnId, 'turnId'),
        userId: requiredStringPayload(job.payload.userId, 'userId'),
      }),
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

  const emailOutboxWorker = createEmailOutboxWorker(args)

  return { automationRuns, emailOutboxWorker, jobs, scheduler, worker }
}

function createEmailOutboxWorker(args: {
  db: OverlayPostgresDb
  leaseMs: number
  runtimeConfig?: OverlayRuntimeConfig
  workerId: string
}): PostgresOutboxWorker | null {
  const config = args.runtimeConfig
  const providerName = config?.providers.email?.provider ?? config?.email?.provider ?? 'none'
  if (!config || config.features.transactionalEmail === false || providerName === 'none') return null
  const delivery = new EmailOutboxDelivery({
    audit: new AuditService(new PostgresAuditRepository(args.db)),
    config,
    provider: createLazyEmailProvider(config),
    recipients: new PostgresEmailRecipientRepository(args.db),
    suppressions: new PostgresEmailSuppressionRepository(args.db),
  })
  return new PostgresOutboxWorker({
    leaseMs: args.leaseMs,
    publisher: delivery.publisher(),
    repository: new PostgresOutboxRepository(args.db),
    workerId: `${args.workerId}:email`,
  })
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
