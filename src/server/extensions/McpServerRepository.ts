import 'server-only'

export type McpAuthType = 'none' | 'bearer' | 'header' | 'oauth'
export type McpTransport = 'sse' | 'streamable-http'
export type McpToolPolicyMode = 'allow' | 'approval_required' | 'deny'
export type McpExecutionStatus = 'succeeded' | 'failed' | 'denied'
export type McpOAuthStatus = 'pending' | 'connected' | 'needs_reauth'
export type McpOAuthSurface = 'web' | 'desktop'

export type McpAuthConfig = {
  bearerToken?: string
  headerName?: string
  headerValue?: string
}

/** Sealed at rest with McpCredentialCipher; never returned by list APIs. */
export type McpOAuthTokens = {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. Absent when the server issues non-expiring tokens. */
  expiresAt?: number
  scope?: string
  tokenType?: string
}

/** Sealed at rest. `clientId` is stored separately in the clear because it is not a secret. */
export type McpOAuthClient = {
  clientId: string
  clientSecret?: string
  /** Set for DCR registrations so we can tell them apart from user-supplied credentials. */
  registered?: boolean
}

export type McpOAuthSession = {
  id: string
  userId: string
  mcpServerId: string
  codeVerifier: string
  surface: McpOAuthSurface
  returnTo?: string
  sessionBindingHash?: string
  expiresAt: number
  createdAt: number
}

export type McpToolCatalogEntry = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type McpServerRecord = {
  _id: string
  userId: string
  projectId?: string
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled: boolean
  authType: McpAuthType
  authConfig?: McpAuthConfig
  hasAuth: boolean
  timeoutMs?: number
  defaultToolPolicy: McpToolPolicyMode
  toolPolicies: Record<string, McpToolPolicyMode>
  toolCatalog: McpToolCatalogEntry[]
  toolCatalogUpdatedAt?: number
  toolCatalogError?: string
  /** Decrypted for runtime use only — stripped from McpServerSummary. */
  oauthTokens?: McpOAuthTokens
  oauthClient?: McpOAuthClient
  oauthStatus?: McpOAuthStatus
  oauthClientId?: string
  oauthIssuer?: string
  oauthScope?: string
  oauthResource?: string
  oauthConnectedAt?: number
  oauthError?: string
  oauthTokenVersion?: number
  createdAt: number
  updatedAt: number
}

export type McpServerSummary =
  & Omit<McpServerRecord, 'authConfig' | 'toolCatalog' | 'oauthTokens' | 'oauthClient'>
  & { toolCatalogCount: number }

export type CreateMcpServerInput = {
  userId: string
  projectId?: string
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled?: boolean
  authType?: McpAuthType
  authConfig?: McpAuthConfig
  timeoutMs?: number
  defaultToolPolicy?: McpToolPolicyMode
  toolPolicies?: Record<string, McpToolPolicyMode>
  workspaceId?: string
}

export type UpdateMcpServerInput = Partial<Omit<CreateMcpServerInput, 'userId'>> & {
  mcpServerId: string
  userId: string
}

export type McpExecutionRecord = {
  id: string
  userId: string
  projectId?: string
  mcpServerId: string
  toolName: string
  argumentsHash: string
  policyDecision: McpToolPolicyMode
  status: McpExecutionStatus
  conversationId?: string
  turnId?: string
  modelId?: string
  durationMs?: number
  errorMessage?: string
  createdAt: number
}

export interface McpServerRepository {
  list(args: { userId: string; projectId?: string; workspaceId?: string }): Promise<McpServerSummary[]>
  listEnabled(args: { userId: string; projectId?: string; workspaceId?: string }): Promise<McpServerRecord[]>
  get(args: { mcpServerId: string; userId: string; workspaceId?: string }): Promise<McpServerRecord | null>
  create(args: CreateMcpServerInput): Promise<string>
  update(args: UpdateMcpServerInput): Promise<void>
  remove(args: { mcpServerId: string; userId: string; workspaceId?: string }): Promise<void>
  updateToolCatalog(args: {
    mcpServerId: string
    userId: string
    tools: McpToolCatalogEntry[]
    catalogError?: string
  }): Promise<void>
  /**
   * Persist OAuth state. `expectedTokenVersion` makes token writes compare-and-set so two
   * concurrent refreshes cannot clobber each other when the server rotates refresh tokens;
   * returns false when the caller lost the race and should re-read.
   */
  updateOAuthState(args: {
    mcpServerId: string
    userId: string
    tokens?: McpOAuthTokens | null
    client?: McpOAuthClient | null
    status?: McpOAuthStatus
    issuer?: string
    scope?: string
    resource?: string
    error?: string | null
    expectedTokenVersion?: number
  }): Promise<boolean>
  createOAuthSession(args: Omit<McpOAuthSession, 'createdAt'> & { createdAt?: number }): Promise<void>
  /** Single-use: the row is deleted as it is read, so a replayed `state` finds nothing. */
  consumeOAuthSession(args: { sessionId: string }): Promise<McpOAuthSession | null>
  deleteExpiredOAuthSessions(args: { now?: number }): Promise<number>
  recordExecution(args: Omit<McpExecutionRecord, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: number
  }): Promise<string>
  listExecutions(args: {
    userId: string
    mcpServerId?: string
    limit?: number
  }): Promise<McpExecutionRecord[]>
}

export function resolveMcpToolPolicy(
  server: Pick<McpServerRecord, 'defaultToolPolicy' | 'toolPolicies'>,
  toolName: string,
): McpToolPolicyMode {
  return server.toolPolicies[toolName] ?? server.defaultToolPolicy
}
