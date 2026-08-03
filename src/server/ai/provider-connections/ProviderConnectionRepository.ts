import 'server-only'

import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

export type ProviderConnectionStatus = ByokConnectionRow['status']

/**
 * Server-only representation. `credentialRef` is an opaque identifier owned by
 * the configured secret store; provider API keys never enter app-data storage.
 */
export type ProviderConnectionRecord = ByokConnectionRow & {
  userId: string
  credentialRef?: string
}

export type CreateProviderConnectionInput = {
  userId: string
  providerId: string
  endpoint: string
  displayName: string
  credentialRef?: string
  enabledModelIds: string[]
  isDefault: boolean
  isDeletable: boolean
}

export type UpdateProviderConnectionInput = {
  connectionId: string
  userId: string
  displayName?: string
  endpoint?: string
  credentialRef?: string
  enabledModelIds?: string[]
  discoveredModelsJson?: string
  discoveredAt?: number
  status?: ProviderConnectionStatus
  lastError?: string
  lastTestedAt?: number
}

export interface ProviderConnectionRepository {
  count(args: { userId: string }): Promise<number>
  listPublic(args: { userId: string }): Promise<ByokConnectionRow[]>
  get(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null>
  create(args: CreateProviderConnectionInput): Promise<string>
  update(args: UpdateProviderConnectionInput): Promise<void>
  remove(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null>
  ensureDefaultGateway(args: {
    userId: string
    endpoint: string
    displayName: string
    enabledModelIds: string[]
    discoveredModelsJson?: string
    discoveredAt?: number
  }): Promise<ByokConnectionRow>
  listCredentialRefs(args: { userId: string }): Promise<string[]>
}
