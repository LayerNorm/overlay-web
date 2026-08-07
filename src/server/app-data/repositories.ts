import 'server-only'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import type { AccountDataDeletionRepository } from '@/server/account/AccountDataDeletionRepository'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { ConvexAutomationRepository } from '@/server/automations/ConvexAutomationRepository'
import { PostgresAutomationRepository } from '@/server/automations/PostgresAutomationRepository'
import type { AutomationRepository } from '@/server/automations/AutomationRepository'
import { ConvexBillingRepository } from '@/server/billing/ConvexBillingRepository'
import { ConvexBillingProviderEventRepository } from '@/server/billing/ConvexBillingProviderEventRepository'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { BillingProviderEventRepository, BillingWebhookRepository } from '@/server/billing/BillingProviderEventRepository'
import { PostgresBillingProviderEventRepository, PostgresBillingRepository } from '@/server/billing/PostgresBillingRepository'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresConversationEventNotifier } from '@/server/conversations/PostgresConversationEventNotifier'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import { ConvexConversationCollaborationRepository } from '@/server/conversations/ConvexConversationCollaborationRepository'
import { PostgresConversationCollaborationRepository } from '@/server/conversations/PostgresConversationCollaborationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import type { FileRepository } from '@/server/files/FileRepository'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { ConvexNoteRepository, PostgresNoteRepository, type NoteRepository } from '@/server/notes'
import {
  PostgresMemoryRepository,
  type MemoryRepository,
} from '@/server/memory'
import { ConvexMemoryRepository } from '@/server/memory/ConvexMemoryRepository'
import {
  PostgresOnboardingRepository,
  type OnboardingRepository,
} from '@/server/onboarding'
import {
  PostgresAppSettingsRepository,
  type AppSettingsRepository,
} from '@/server/settings'
import { ConvexUserRepository, PostgresUserRepository, type UserRepository } from '@/server/users'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import type { ProjectRepository } from '@/server/projects/ProjectRepository'
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
  ConvexOutboxRepository,
  type DurableJobRepository,
  type OutboxRepository,
} from '@/server/jobs'
import {
  ConvexModelCatalogRepository,
  PostgresModelCatalogRepository,
  type ModelCatalogRepository,
} from '@/server/ai/catalog'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { ConvexChatSuggestionRepository } from '@/server/chat-suggestions/ConvexChatSuggestionRepository'
import { PostgresChatSuggestionRepository } from '@/server/chat-suggestions/PostgresChatSuggestionRepository'
import type { ChatSuggestionRepository } from '@/server/chat-suggestions/ChatSuggestionRepository'
import type { DaytonaWorkspaceRepository } from '@/server/ai/sandbox/DaytonaWorkspaceRepository'
import { ConvexDaytonaWorkspaceRepository } from '@/server/ai/sandbox/ConvexDaytonaWorkspaceRepository'
import { PostgresDaytonaWorkspaceRepository } from '@/server/ai/sandbox/PostgresDaytonaWorkspaceRepository'
import { deriveAppDataCapabilities, type AppDataCapabilities } from './capabilities'
import {
  ConvexWebhookRepository,
  PostgresWebhookRepository,
  type WebhookRepository,
} from '@/server/webhooks'
import { unsupportedRepository } from './errors'
import type { UsageRepository } from '@/server/usage'
import { ConvexUsageRepository, PostgresUsageRepository } from '@/server/usage'
import {
  ConvexApiKeyRepository,
  PostgresApiKeyRepository,
  type ApiKeyRepository,
} from '@/server/auth/api-keys'
import {
  ConvexAdministrativeRepository,
  ConvexAuditRepository,
  PostgresAdministrativeRepository,
  PostgresAuditRepository,
  type AdministrativeRepository,
  type AuditRepository,
} from '@/server/admin'
import {
  ConvexMcpServerRepository,
  ConvexSkillRepository,
  PostgresMcpServerRepository,
  PostgresSkillRepository,
  type McpServerRepository,
  type SkillRepository,
} from '@/server/extensions'

export interface AppDataRepositories {
  accountDeletion: AccountDataDeletionRepository
  administration: AdministrativeRepository
  apiKeys: ApiKeyRepository
  audit: AuditRepository
  automations: AutomationRepository
  billing: BillingRepository
  billingEvents: BillingProviderEventRepository
  billingWebhooks: BillingWebhookRepository
  chatSuggestions: ChatSuggestionRepository
  conversationCollaboration: ConversationCollaborationRepository
  conversations: ActConversationRepository
  durableJobs: DurableJobRepository
  daytonaWorkspaces: DaytonaWorkspaceRepository
  files: FileRepository
  idempotency: IdempotencyRepository
  modelCatalog: ModelCatalogRepository
  memories: MemoryRepository
  mcpServers: McpServerRepository
  notes: NoteRepository
  onboarding: OnboardingRepository
  outbox: OutboxRepository
  projects: ProjectRepository
  settings: AppSettingsRepository
  skills: SkillRepository
  serviceAuthReplay: ServiceAuthReplayRepository
  users: UserRepository
  webhooks: WebhookRepository
  usage: UsageRepository
}

export interface AppDataContext {
  capabilities: AppDataCapabilities
  postgres?: { db: ReturnType<typeof createOverlayPostgresDb> }
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
    const conversations = new PostgresActConversationRepository(
      db,
      new PostgresConversationEventNotifier(pool),
      { memoryExtractionEnabled: capabilities.supportsVectorSearch && runtimeConfig.features.memory !== false },
    )
    const billing = new PostgresBillingRepository(db)
    return {
      capabilities,
      postgres: { db },
      repositories: {
        accountDeletion: new PostgresAccountDataDeletionRepository(db),
        administration: new PostgresAdministrativeRepository(db),
        apiKeys: new PostgresApiKeyRepository(db),
        audit: new PostgresAuditRepository(db),
        automations: new PostgresAutomationRepository(db, conversations),
        billing,
        billingEvents: new PostgresBillingProviderEventRepository(db),
        billingWebhooks: billing,
        chatSuggestions: new PostgresChatSuggestionRepository(db),
        conversationCollaboration: new PostgresConversationCollaborationRepository(db),
        conversations,
        durableJobs: new PostgresDurableJobRepository(db),
        daytonaWorkspaces: new PostgresDaytonaWorkspaceRepository(db),
        files: new PostgresFileRepository(db),
        idempotency: new PostgresIdempotencyRepository(db),
        modelCatalog: new PostgresModelCatalogRepository(db),
        memories: new PostgresMemoryRepository(db),
        mcpServers: new PostgresMcpServerRepository(db),
        notes: new PostgresNoteRepository(db),
        onboarding: new PostgresOnboardingRepository(db),
        outbox: new PostgresOutboxRepository(db),
        projects: new PostgresProjectRepository(db),
        settings: new PostgresAppSettingsRepository(db),
        skills: new PostgresSkillRepository(db),
        serviceAuthReplay: new PostgresServiceAuthReplayRepository(db),
        users: new PostgresUserRepository(db),
        webhooks: new PostgresWebhookRepository(db),
        usage: new PostgresUsageRepository(db),
      },
    }
  }

  return {
    capabilities,
    repositories: {
      accountDeletion: unsupportedRepository<AccountDataDeletionRepository>('AccountDataDeletionRepository'),
      administration: new ConvexAdministrativeRepository(),
      apiKeys: new ConvexApiKeyRepository(),
      audit: new ConvexAuditRepository(),
      automations: new ConvexAutomationRepository(),
      billing: new ConvexBillingRepository(),
      billingEvents: new ConvexBillingProviderEventRepository(),
      billingWebhooks: new ConvexBillingRepository(),
      chatSuggestions: new ConvexChatSuggestionRepository(),
      conversationCollaboration: new ConvexConversationCollaborationRepository(),
      conversations: new ConvexActConversationRepository(),
      durableJobs: unsupportedRepository<DurableJobRepository>('DurableJobRepository'),
      daytonaWorkspaces: new ConvexDaytonaWorkspaceRepository(),
      files: new ConvexFileRepository(),
      idempotency: new ConvexIdempotencyRepository(),
      modelCatalog: new ConvexModelCatalogRepository(),
      memories: new ConvexMemoryRepository(),
      mcpServers: new ConvexMcpServerRepository(),
      notes: new ConvexNoteRepository(),
      onboarding: unsupportedRepository<OnboardingRepository>('OnboardingRepository'),
      outbox: new ConvexOutboxRepository(),
      projects: new ConvexProjectRepository(),
      settings: unsupportedRepository<AppSettingsRepository>('AppSettingsRepository'),
      skills: new ConvexSkillRepository(),
      serviceAuthReplay: new ConvexServiceAuthReplayRepository(),
      users: new ConvexUserRepository(),
      webhooks: new ConvexWebhookRepository(),
      usage: new ConvexUsageRepository(),
    },
  }
}
