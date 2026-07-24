export type IntegrationProviderId = 'composio' | 'executor'
export type IntegrationOAuthOwnership = 'provider-managed' | 'customer-managed' | 'mixed'
export type IntegrationConnectionSetup = 'in-app-oauth' | 'provider-console' | 'manual-credential'
export type IntegrationConnectionLifecycle = 'overlay-managed' | 'provider-managed'
export type IntegrationSchemaKind = 'native' | 'mcp' | 'openapi' | 'graphql'

export interface IntegrationProviderCapabilities {
  provider: IntegrationProviderId
  hosted: boolean
  selfHosted: boolean
  oauthOwnership: IntegrationOAuthOwnership
  connectionSetup: IntegrationConnectionSetup
  connectionLifecycle: IntegrationConnectionLifecycle
  supportsApprovals: boolean
  supportsDisconnect: boolean
  supportedSchemas: IntegrationSchemaKind[]
}

export type IntegrationAuthenticationState =
  | 'not-connected'
  | 'connected'
  | 'expired'
  | 'degraded'
  | 'unknown'

export interface IntegrationSummary {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  provider: IntegrationProviderId
  providerKey: string
  capabilities: IntegrationProviderCapabilities
  authenticationState?: IntegrationAuthenticationState
  connectionSetupUrl?: string | null
  isConnected?: boolean
  connectedAccountId?: string | null
}

export interface IntegrationSearchResponse {
  data?: IntegrationSummary[]
  items: IntegrationSummary[]
  nextCursor?: string | null
  hasMore?: boolean
  total?: number
}

export interface ConnectedIntegrationsResponse {
  provider?: IntegrationProviderId
  providerCapabilities?: IntegrationProviderCapabilities
  connected: string[]
  data?: IntegrationSummary[]
  items?: IntegrationSummary[]
  hasMore?: boolean
  total?: number
}

export interface IntegrationConnectionRequest {
  action?: 'connect' | 'disconnect'
  providerKey?: string
  /** Backward-compatible alias for older desktop clients. */
  toolkit?: string
  accessToken?: string
  userId?: string
}

export interface IntegrationConnectionResponse {
  success?: boolean
  redirectUrl?: string | null
  connectionId?: string | null
  status?: string | null
  provider?: IntegrationProviderId
  providerCapabilities?: IntegrationProviderCapabilities
  error?: string
}

export interface SkillSummary {
  _id: string
  name: string
  description: string
  instructions: string
  enabled?: boolean
  projectId?: string
  createdAt?: number
  updatedAt?: number
}

export interface CreateSkillRequest {
  name: string
  description: string
  instructions: string
  enabled?: boolean
  projectId?: string
  accessToken?: string
  userId?: string
}

export interface UpdateSkillRequest {
  skillId: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  accessToken?: string
  userId?: string
}

export interface CreateEntityResponse {
  id: string
  error?: string
}
