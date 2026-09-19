import 'server-only'

import type { AccountDataDeletionRepository } from '@/server/account/AccountDataDeletionRepository'
import { ConvexAutomationRepository } from '@/server/automations/ConvexAutomationRepository'
import type { AutomationRepository } from '@/server/automations/AutomationRepository'
import { ConvexBillingRepository } from '@/server/billing/ConvexBillingRepository'
import { ConvexBillingProviderEventRepository } from '@/server/billing/ConvexBillingProviderEventRepository'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { BillingProviderEventRepository, BillingWebhookRepository } from '@/server/billing/BillingProviderEventRepository'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import { ConvexConversationCollaborationRepository } from '@/server/conversations/ConvexConversationCollaborationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import type { FileRepository } from '@/server/files/FileRepository'
import { ConvexFileIngestionJobRepository } from '@/server/files/ConvexFileIngestionJobRepository'
import type { FileIngestionJobRepository } from '@/server/files/FileIngestionJobRepository'
import { ConvexNoteRepository, type NoteRepository } from '@/server/notes'
import { type MemoryRepository } from '@/server/memory'
import { ConvexMemoryRepository } from '@/server/memory/ConvexMemoryRepository'
import { type OnboardingRepository } from '@/server/onboarding'
import { type AppSettingsRepository } from '@/server/settings'
import { ConvexUserRepository, type UserRepository } from '@/server/users'
import {
  ConvexIdempotencyRepository,
  type IdempotencyRepository,
} from '@/server/idempotency'
import {
  ConvexServiceAuthReplayRepository,
  type ServiceAuthReplayRepository,
} from '@/server/auth/replay'
import {
  ConvexOutboxRepository,
  type DurableJobRepository,
  type OutboxRepository,
} from '@/server/jobs'
import {
  ConvexModelCatalogRepository,
  type ModelCatalogRepository,
} from '@/server/ai/catalog'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { ConvexChatSuggestionRepository } from '@/server/chat-suggestions/ConvexChatSuggestionRepository'
import type { ChatSuggestionRepository } from '@/server/chat-suggestions/ChatSuggestionRepository'
import type { DaytonaWorkspaceRepository } from '@/server/ai/sandbox/DaytonaWorkspaceRepository'
import { ConvexDaytonaWorkspaceRepository } from '@/server/ai/sandbox/ConvexDaytonaWorkspaceRepository'
import { deriveAppDataCapabilities, type AppDataCapabilities } from './capabilities'
import {
  ConvexWebhookRepository,
  type WebhookRepository,
} from '@/server/webhooks'
import { unsupportedRepository } from './errors'
import type { UsageRepository } from '@/server/usage'
import { ConvexUsageRepository } from '@/server/usage'
import {
  ConvexApiKeyRepository,
  type ApiKeyRepository,
} from '@/server/auth/api-keys'
import {
  ConvexAdministrativeRepository,
  ConvexAuditRepository,
  type AdministrativeRepository,
  type AuditRepository,
} from '@/server/admin'
import {
  ConvexMcpServerRepository,
  ConvexSkillRepository,
  type McpServerRepository,
  type SkillRepository,
} from '@/server/extensions'
import type { AuthorizationRepositories } from '@overlay/authz-contracts'
import { createConvexAuthorizationRepositories } from '@/server/authorization/ConvexAuthorizationRepositories'
import {
  ConvexWorkspaceConnectorRepository,
  type WorkspaceConnectorRepository,
} from '@/server/integrations'
import type { ConnectedAgentRepository } from '@/server/agents/ConnectedAgentRepository'
import { ConvexConnectedAgentRepository } from '@/server/agents/ConvexConnectedAgentRepository'
import {
  ConvexProviderConnectionRepository,
  type ProviderConnectionRepository,
} from '@/server/ai/provider-connections'
import type { ComputerRepository } from '@/server/computers/ComputerRepository'
import { ConvexComputerRepository } from '@/server/computers/ConvexComputerRepository'

export interface AppDataRepositories {
  accountDeletion: AccountDataDeletionRepository
  administration: AdministrativeRepository
  apiKeys: ApiKeyRepository
  audit: AuditRepository
  authorization: AuthorizationRepositories
  automations: AutomationRepository
  billing: BillingRepository
  billingEvents: BillingProviderEventRepository
  billingWebhooks: BillingWebhookRepository
  chatSuggestions: ChatSuggestionRepository
  computers: ComputerRepository
  conversationCollaboration: ConversationCollaborationRepository
  conversations: ActConversationRepository
  durableJobs: DurableJobRepository
  daytonaWorkspaces: DaytonaWorkspaceRepository
  files: FileRepository
  fileIngestionJobs: FileIngestionJobRepository
  idempotency: IdempotencyRepository
  modelCatalog: ModelCatalogRepository
  memories: MemoryRepository
  mcpServers: McpServerRepository
  notes: NoteRepository
  onboarding: OnboardingRepository
  outbox: OutboxRepository
  providerConnections: ProviderConnectionRepository
  settings: AppSettingsRepository
  skills: SkillRepository
  serviceAuthReplay: ServiceAuthReplayRepository
  users: UserRepository
  webhooks: WebhookRepository
  usage: UsageRepository
  workspaceConnectors: WorkspaceConnectorRepository
  connectedAgents: ConnectedAgentRepository
}

export interface AppDataContext {
  capabilities: AppDataCapabilities
  repositories: AppDataRepositories
}

export function createAppDataContext(runtimeConfig: OverlayRuntimeConfig | null): AppDataContext {
  const capabilities = deriveAppDataCapabilities(runtimeConfig)
  return {
    capabilities,
    repositories: {
      accountDeletion: unsupportedRepository<AccountDataDeletionRepository>('AccountDataDeletionRepository'),
      administration: new ConvexAdministrativeRepository(),
      apiKeys: new ConvexApiKeyRepository(),
      audit: new ConvexAuditRepository(),
      authorization: createConvexAuthorizationRepositories(),
      automations: new ConvexAutomationRepository(),
      billing: new ConvexBillingRepository(),
      billingEvents: new ConvexBillingProviderEventRepository(),
      billingWebhooks: new ConvexBillingRepository(),
      chatSuggestions: new ConvexChatSuggestionRepository(),
      computers: new ConvexComputerRepository(),
      conversationCollaboration: new ConvexConversationCollaborationRepository(),
      conversations: new ConvexActConversationRepository(),
      durableJobs: unsupportedRepository<DurableJobRepository>('DurableJobRepository'),
      daytonaWorkspaces: new ConvexDaytonaWorkspaceRepository(),
      files: new ConvexFileRepository(),
      fileIngestionJobs: new ConvexFileIngestionJobRepository(),
      idempotency: new ConvexIdempotencyRepository(),
      modelCatalog: new ConvexModelCatalogRepository(),
      memories: new ConvexMemoryRepository(),
      mcpServers: new ConvexMcpServerRepository(),
      notes: new ConvexNoteRepository(),
      onboarding: unsupportedRepository<OnboardingRepository>('OnboardingRepository'),
      outbox: new ConvexOutboxRepository(),
      providerConnections: new ConvexProviderConnectionRepository(),
      settings: unsupportedRepository<AppSettingsRepository>('AppSettingsRepository'),
      skills: new ConvexSkillRepository(),
      serviceAuthReplay: new ConvexServiceAuthReplayRepository(),
      users: new ConvexUserRepository(),
      webhooks: new ConvexWebhookRepository(),
      usage: new ConvexUsageRepository(),
      workspaceConnectors: new ConvexWorkspaceConnectorRepository(),
      connectedAgents: new ConvexConnectedAgentRepository(),
    },
  }
}
