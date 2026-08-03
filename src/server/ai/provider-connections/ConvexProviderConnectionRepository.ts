import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import type {
  CreateProviderConnectionInput,
  ProviderConnectionRecord,
  ProviderConnectionRepository,
  UpdateProviderConnectionInput,
} from './ProviderConnectionRepository'

type ConvexConnectionRecord = ProviderConnectionRecord & {
  vaultObjectId?: string
}

export class ConvexProviderConnectionRepository implements ProviderConnectionRepository {
  async count(args: { userId: string }): Promise<number> {
    return (await this.listPublic(args)).length
  }

  async listPublic(args: { userId: string }): Promise<ByokConnectionRow[]> {
    return (await convex.query<ByokConnectionRow[]>(
      'providers/connections:listPublicByServer',
      { serverSecret: getInternalApiSecret(), userId: args.userId },
      { throwOnError: true },
    )) ?? []
  }

  async get(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null> {
    const row = await convex.query<ConvexConnectionRecord | null>(
      'providers/connections:getByServer',
      { serverSecret: getInternalApiSecret(), connectionId: args.connectionId },
      { throwOnError: true },
    )
    if (!row || row.userId !== args.userId) return null
    return { ...row, credentialRef: row.vaultObjectId }
  }

  async create(args: CreateProviderConnectionInput): Promise<string> {
    const connectionId = await convex.mutation<string>(
      'providers/connections:createByServer',
      {
        serverSecret: getInternalApiSecret(),
        userId: args.userId,
        providerId: args.providerId,
        endpoint: args.endpoint,
        displayName: args.displayName,
        // Retained only for hosted WorkOS-Vault compatibility. The credential
        // reference itself is opaque in both storage backends.
        vaultKeyName: '',
        ...(args.credentialRef ? { vaultObjectId: args.credentialRef } : {}),
        enabledModelIds: args.enabledModelIds,
        isDefault: args.isDefault,
        isDeletable: args.isDeletable,
      },
      { throwOnError: true },
    )
    if (!connectionId) throw new Error('Failed to create provider connection')
    return connectionId
  }

  async update(args: UpdateProviderConnectionInput): Promise<void> {
    const existing = await this.get({ connectionId: args.connectionId, userId: args.userId })
    if (!existing) throw new Error('Connection not found')
    await convex.mutation(
      'providers/connections:updateByServer',
      {
        serverSecret: getInternalApiSecret(),
        connectionId: args.connectionId,
        ...(args.displayName !== undefined ? { displayName: args.displayName } : {}),
        ...(args.endpoint !== undefined ? { endpoint: args.endpoint } : {}),
        ...(args.credentialRef !== undefined ? { vaultObjectId: args.credentialRef } : {}),
        ...(args.enabledModelIds !== undefined ? { enabledModelIds: args.enabledModelIds } : {}),
        ...(args.discoveredModelsJson !== undefined ? { discoveredModelsJson: args.discoveredModelsJson } : {}),
        ...(args.discoveredAt !== undefined ? { discoveredAt: args.discoveredAt } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
        ...(args.lastTestedAt !== undefined ? { lastTestedAt: args.lastTestedAt } : {}),
      },
      { throwOnError: true },
    )
  }

  async remove(args: { connectionId: string; userId: string }): Promise<ProviderConnectionRecord | null> {
    const existing = await this.get(args)
    if (!existing) return null
    if (!existing.isDeletable) throw new Error('This connection cannot be deleted (it is the default provider)')
    await convex.mutation(
      'providers/connections:deleteByServer',
      { serverSecret: getInternalApiSecret(), connectionId: args.connectionId },
      { throwOnError: true },
    )
    return existing
  }

  async ensureDefaultGateway(args: {
    userId: string
    endpoint: string
    displayName: string
    enabledModelIds: string[]
    discoveredModelsJson?: string
    discoveredAt?: number
  }): Promise<ByokConnectionRow> {
    const connection = await convex.mutation<ByokConnectionRow>(
      'providers/connections:ensureDefaultGatewayByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    if (!connection) throw new Error('Failed to ensure default provider connection')
    return connection
  }

  async listCredentialRefs(_args: { userId: string }): Promise<string[]> {
    // Convex only exposes credential references per record to the trusted BFF.
    // Account deletion remains owned by its existing Convex implementation.
    return []
  }
}
