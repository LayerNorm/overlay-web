import 'server-only'

import type {
  IntegrationConnectionResponse,
  IntegrationProviderCapabilities,
  IntegrationProviderId,
  IntegrationSummary,
} from '@overlay/app-core'
import type { ToolSet } from 'ai'

export interface IntegrationCatalogQuery {
  cursor?: string
  limit: number
  query?: string
  userId: string
  accessToken?: string
  workspaceId?: string
}

export interface IntegrationCatalogPage {
  items: IntegrationSummary[]
  nextCursor: string | null
  hasMore: boolean
  syncCursor?: string | null
}

export interface IntegrationConnection {
  id: string
  provider: IntegrationProviderId
  providerKey: string
  userId: string
  authenticationState: NonNullable<IntegrationSummary['authenticationState']>
  identityLabel?: string | null
  expiresAt?: number | null
}

export interface IntegrationConnectionContext {
  accessToken?: string
  callbackOrigin: string
  providerKey: string
  userId: string
  workspaceId?: string
}

export interface IntegrationHealth {
  provider: IntegrationProviderId
  status: 'healthy' | 'degraded' | 'unavailable' | 'unconfigured'
  checkedAt: number
  message?: string
}

export interface IntegrationExecutionRequest {
  args: unknown
  toolId: string
  userId: string
  conversationId?: string
  turnId?: string
}

export interface IntegrationExecutionResult {
  status: 'completed' | 'paused' | 'failed' | 'denied'
  output?: unknown
  executionId?: string
  error?: string
}

export interface IntegrationPolicyDecision {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
}

export interface IntegrationCatalog {
  listCatalog(query: IntegrationCatalogQuery): Promise<IntegrationCatalogPage>
  getCatalogEntry(args: {
    accessToken?: string
    providerKey: string
    userId: string
    workspaceId?: string
  }): Promise<IntegrationSummary | null>
}

export interface ConnectionRepository {
  listConnections(args: { accessToken?: string; userId: string; workspaceId?: string }): Promise<IntegrationConnection[]>
  disconnect(context: IntegrationConnectionContext): Promise<void>
  deleteConnectionsForUser(args: { accessToken?: string; userId: string }): Promise<number>
}

export interface CredentialBroker {
  beginConnection(context: IntegrationConnectionContext): Promise<IntegrationConnectionResponse>
}

export interface ToolExecutor {
  createToolSet(args: {
    accessToken?: string
    userId: string
    conversationId?: string
    turnId?: string
  }): Promise<ToolSet>
  execute(request: IntegrationExecutionRequest): Promise<IntegrationExecutionResult>
}

export interface IntegrationPolicyEvaluator {
  evaluate(args: {
    capabilities: IntegrationProviderCapabilities
    operation: 'catalog' | 'connect' | 'disconnect' | 'execute'
    requiresApproval?: boolean
  }): IntegrationPolicyDecision
}

export interface IntegrationProvider
  extends IntegrationCatalog, ConnectionRepository, CredentialBroker, ToolExecutor {
  readonly id: IntegrationProviderId
  readonly capabilities: IntegrationProviderCapabilities
  health(): Promise<IntegrationHealth>
}
