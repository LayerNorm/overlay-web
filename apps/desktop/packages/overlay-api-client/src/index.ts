export { createOverlayAppClient, type OverlayAppClient } from './create-overlay-app-client'

export type {
  CreateOverlayAppClientOptions,
  ErrorResponse,
  PaginatedEnvelope,
  Pagination,
  PaginationOrder,
  PaginationQuery,
  PaginationSort,
} from './shared/types'
export type {
  ActConversationRequest,
  ConversationGetResponse,
  ConversationMessageRequest,
  ConversationQuery,
  CreateConversationRequest,
  CreateConversationResponse,
  StreamAuthRequest,
  StreamAuthResponse,
  UpdateConversationRequest,
} from './chat/types'
export type { FileQuery } from './files/types'
export type { NoteFileQuery, NoteQuery } from './notes/types'
export type { ProjectQuery } from './projects/types'
export type { AutomationQuery } from './automations/types'
export type { IntegrationQuery } from './integrations/types'
export type { SkillQuery } from './skills/types'
export type { McpServerQuery } from './mcp-servers/types'
export type { MemoryQuery } from './memory/types'
export type { OutputQuery } from './outputs/types'
export type { OverlayServerDiscovery } from './discovery/types'

export { ConversationsClient } from './chat/conversations-client'
export { ChatAuxClient } from './chat/chat-aux-client'
export { FilesClient } from './files/client'
export { NotesClient } from './notes/client'
export { ProjectsClient } from './projects/client'
export { AutomationsClient } from './automations/client'
export { AccountClient } from './auth/account-client'
export { BillingClient } from './auth/billing-client'
export { SubscriptionClient } from './auth/subscription-client'
export { TopUpsClient } from './auth/topups-client'
export { BootstrapClient } from './bootstrap/client'
export { DiscoveryClient } from './discovery/client'
export { MemoryClient } from './memory/client'
export { OutputsClient } from './outputs/client'
export { IntegrationsClient } from './integrations/client'
export { SkillsClient } from './skills/client'
export { McpServersClient } from './mcp-servers/client'
export { SettingsClient } from './settings/client'
export { OnboardingClient } from './onboarding/client'
export { AutomationRunsClient } from './automation-runs/client'
export {
  WebhooksClient,
  type WebhookDelivery,
  type WebhookSubscription,
} from './webhooks/client'
export { createHttpContext, type HttpContext } from './shared/http'
export { createIdempotencyKey, toRequestInit, type MutationRequestInit } from './shared/mutation'
export * from './schemas'
