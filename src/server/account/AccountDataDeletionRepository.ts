import 'server-only'

export interface AccountDataDeletionCounts {
  apiIdempotencyKeys: number
  apiKeys: number
  administrativePrincipals: number
  authorizationGroupMemberships: number
  authorizationResourceGrants: number
  authorizationUserRoles: number
  automationRunAttempts: number
  automationRuns: number
  automationTriggers: number
  automations: number
  billingSubscriptions: number
  billingTopUps: number
  authIdentities: number
  conversationContextSummaries: number
  conversationEvents: number
  conversationMessageDeltas: number
  conversationMessages: number
  conversations: number
  daytonaWorkspaces: number
  files: number
  governanceAccessReviews: number
  governancePolicies: number
  knowledgeChunkEmbeddings: number
  knowledgeChunks: number
  memoryExtractionRuns: number
  memories: number
  mcpServers: number
  mcpToolExecutions: number
  notes: number
  onboardingState: number
  projects: number
  r2UploadIntents: number
  skills: number
  userSettings: number
  users: number
  usageBudgetAccounts: number
  usageBudgetTransactions: number
  usageEvents: number
  usageReservations: number
  webhookDeliveries: number
  webhookDeliveryAttempts: number
  webhookSubscriptions: number
  workspacePersonalWorkspaces: number
  workspacePrincipals: number
}

export interface AccountDataDeletionVerification {
  orphanedRowCount: number
  remainingRowsByTable: AccountDataDeletionCounts
}

export interface AccountDataDeletionResult {
  deletedRowCount: number
  email?: string
  r2Keys: string[]
  storageIds: string[]
  userExisted: boolean
  verification: AccountDataDeletionVerification
}

export interface AccountDataDeletionRepository {
  deleteUserAccount(args: { userId: string }): Promise<AccountDataDeletionResult>
}
