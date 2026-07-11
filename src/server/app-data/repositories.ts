import 'server-only'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import type { AccountDataDeletionRepository } from '@/server/account/AccountDataDeletionRepository'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { ConvexAutomationRepository } from '@/server/automations/ConvexAutomationRepository'
import type { AutomationRepository } from '@/server/automations/AutomationRepository'
import { ConvexBillingRepository } from '@/server/billing/ConvexBillingRepository'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresConversationEventNotifier } from '@/server/conversations/PostgresConversationEventNotifier'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import type { FileRepository } from '@/server/files/FileRepository'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { ConvexNoteRepository, PostgresNoteRepository, type NoteRepository } from '@/server/notes'
import {
  PostgresOnboardingRepository,
  type OnboardingRepository,
} from '@/server/onboarding'
import {
  PostgresAppSettingsRepository,
  type AppSettingsRepository,
} from '@/server/settings'
import { ConvexUserRepository, PostgresUserRepository, type UserRepository } from '@/server/users'
import {
  ConvexIdempotencyRepository,
  PostgresIdempotencyRepository,
  type IdempotencyRepository,
} from '@/server/idempotency'
import {
  ConvexServiceAuthReplayRepository,
  PostgresServiceAuthReplayRepository,
  type ServiceAuthReplayRepository,
} from '@/server/auth/replay'
import {
  PostgresDurableJobRepository,
  PostgresOutboxRepository,
  type DurableJobRepository,
  type OutboxRepository,
} from '@/server/jobs'
import {
  ConvexModelCatalogRepository,
  PostgresModelCatalogRepository,
  type ModelCatalogRepository,
} from '@/server/ai/catalog'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { deriveAppDataCapabilities, type AppDataCapabilities } from './capabilities'
import { unsupportedRepository } from './errors'

export interface AppDataRepositories {
  accountDeletion: AccountDataDeletionRepository
  automations: AutomationRepository
  billing: BillingRepository
  conversations: ActConversationRepository
  durableJobs: DurableJobRepository
  files: FileRepository
  idempotency: IdempotencyRepository
  modelCatalog: ModelCatalogRepository
  notes: NoteRepository
  onboarding: OnboardingRepository
  outbox: OutboxRepository
  settings: AppSettingsRepository
  serviceAuthReplay: ServiceAuthReplayRepository
  users: UserRepository
  usage: Record<string, never>
}

export interface AppDataContext {
  capabilities: AppDataCapabilities
  repositories: AppDataRepositories
}

export function createAppDataContext(runtimeConfig: OverlayRuntimeConfig | null): AppDataContext {
  const capabilities = deriveAppDataCapabilities(runtimeConfig)
  if (capabilities.provider === 'postgres') {
    const connectionString = runtimeConfig?.database.postgres.connectionString
    if (!connectionString) {
      throw new Error('database.postgres.connectionString is required for Postgres app-data repositories')
    }
    const pool = createOverlayPostgresPool({
      connectionString,
      sslMode: runtimeConfig.database.postgres.sslMode,
    })
    const db = createOverlayPostgresDb(pool)
    return {
      capabilities,
      repositories: {
        accountDeletion: new PostgresAccountDataDeletionRepository(db),
        automations: unsupportedRepository<AutomationRepository>('AutomationRepository'),
        billing: unsupportedRepository<BillingRepository>('BillingRepository'),
        conversations: new PostgresActConversationRepository(
          db,
          new PostgresConversationEventNotifier(pool),
        ),
        durableJobs: new PostgresDurableJobRepository(db),
        files: new PostgresFileRepository(db),
        idempotency: new PostgresIdempotencyRepository(db),
        modelCatalog: new PostgresModelCatalogRepository(db),
        notes: new PostgresNoteRepository(db),
        onboarding: new PostgresOnboardingRepository(db),
        outbox: new PostgresOutboxRepository(db),
        settings: new PostgresAppSettingsRepository(db),
        serviceAuthReplay: new PostgresServiceAuthReplayRepository(db),
        users: new PostgresUserRepository(db),
        usage: unsupportedRepository<Record<string, never>>('UsageRepository'),
      },
    }
  }

  return {
    capabilities,
    repositories: {
      accountDeletion: unsupportedRepository<AccountDataDeletionRepository>('AccountDataDeletionRepository'),
      automations: new ConvexAutomationRepository(),
      billing: new ConvexBillingRepository(),
      conversations: new ConvexActConversationRepository(),
      durableJobs: unsupportedRepository<DurableJobRepository>('DurableJobRepository'),
      files: new ConvexFileRepository(),
      idempotency: new ConvexIdempotencyRepository(),
      modelCatalog: new ConvexModelCatalogRepository(),
      notes: new ConvexNoteRepository(),
      onboarding: unsupportedRepository<OnboardingRepository>('OnboardingRepository'),
      outbox: unsupportedRepository<OutboxRepository>('OutboxRepository'),
      settings: unsupportedRepository<AppSettingsRepository>('AppSettingsRepository'),
      serviceAuthReplay: new ConvexServiceAuthReplayRepository(),
      users: new ConvexUserRepository(),
      usage: unsupportedRepository<Record<string, never>>('UsageRepository'),
    },
  }
}
