import 'server-only'

import type {
  AgentProviderAccount,
  AgentProviderAccountStatus,
  AgentProviderAuthMethod,
  AgentProviderId,
} from '@/shared/agents/provider-accounts'

/** Server-only: carries the opaque vault reference. Never returned to a client. */
export type AgentProviderAccountRecord = AgentProviderAccount & {
  userId: string
  credentialRef: string
}

export interface AgentProviderAccountRepository {
  listPublic(args: { userId: string }): Promise<AgentProviderAccount[]>
  get(args: { accountId: string }): Promise<AgentProviderAccountRecord | null>
  create(args: {
    userId: string
    provider: AgentProviderId
    method: AgentProviderAuthMethod
    label: string
    credentialRef: string
    maxAccounts: number
  }): Promise<string>
  update(args: {
    accountId: string
    label?: string
    credentialRef?: string
    status?: AgentProviderAccountStatus
    lastError?: string | null
    lastUsedAt?: number
  }): Promise<void>
  remove(args: { accountId: string }): Promise<void>
  /** Vault references of every account the user stored (for account deletion). */
  listCredentialRefs(args: { userId: string }): Promise<string[]>
}
