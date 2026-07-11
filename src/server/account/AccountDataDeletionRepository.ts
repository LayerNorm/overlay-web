import 'server-only'

export interface AccountDataDeletionCounts {
  apiIdempotencyKeys: number
  authIdentities: number
  conversationContextSummaries: number
  conversationEvents: number
  conversationMessageDeltas: number
  conversationMessages: number
  conversations: number
  daytonaWorkspaces: number
  files: number
  notes: number
  onboardingState: number
  projects: number
  r2UploadIntents: number
  userSettings: number
  users: number
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
