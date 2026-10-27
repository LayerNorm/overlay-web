import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { SubscriptionProviderId } from '@/shared/ai/gateway/subscription-providers'
import type { SubscriptionState } from './types'

type FencedArgs = {
  userId: string
  connectionId: string
  generation: number
  revision: number
  leaseToken: string
}

function requireMutationResult<T>(result: T | null | undefined): T {
  if (result === null || result === undefined) {
    throw new Error('Subscription operation returned no result')
  }
  return result
}

export interface SubscriptionRepository {
  get(args: { userId: string; connectionId: string }): Promise<SubscriptionState | null>
  reserveAuthorization(args: { userId: string; connectionId: string; providerId: SubscriptionProviderId; leaseToken: string }): Promise<{ generation: number; revision: number; cleanupRefs: string[] }>
  registerPendingWrite(args: { userId: string; connectionId: string; name: string }): Promise<void>
  clearPendingWrite(args: { userId: string; connectionId: string; name: string }): Promise<void>
  savePendingAuthorization(args: FencedArgs & { pendingStateRef: string; pendingWriteName?: string; expiresAt: number; pollIntervalMs: number }): Promise<{ revision: number; cleanupRefs: string[] }>
  acquirePoll(args: { userId: string; connectionId: string; leaseToken: string }): Promise<{ generation: number; revision: number; pendingStateRef: string; expiresAt: number }>
  releasePendingPoll(args: FencedArgs & { pollIntervalMs: number }): Promise<void>
  acquireRefresh(args: { userId: string; connectionId: string; leaseToken: string }): Promise<{ generation: number; revision: number; credentialRef: string; providerId: SubscriptionProviderId }>
  releaseRefresh(args: FencedArgs): Promise<void>
  commitCredentialForDiscovery(args: FencedArgs & { credentialRef: string; pendingWriteName?: string }): Promise<{ revision: number; cleanupRefs: string[] }>
  acquireDiscovery(args: { userId: string; connectionId: string; leaseToken: string }): Promise<{ generation: number; revision: number; credentialRef: string; providerId: SubscriptionProviderId }>
  releaseDiscovery(args: FencedArgs): Promise<void>
  commitActive(args: FencedArgs & { credentialRef: string; discoveredModelsJson: string; discoveredModelIds: string[]; displayName?: string }): Promise<{ revision: number; enabledModelIds: string[]; cleanupRefs: string[] }>
  failClosed(args: FencedArgs & { error: string }): Promise<string[]>
  disconnect(args: { userId: string; connectionId: string }): Promise<string[]>
  forDispatch(args: { userId: string; connectionId: string; modelId: string }): Promise<{ providerId: SubscriptionProviderId; credentialRef: string; generation: number } | null>
  revokeAllByUser(userId: string): Promise<string[]>
  removeCleanupRef(args: { userId: string; connectionId: string; credentialRef: string }): Promise<void>
  retainCleanupRef(args: { userId: string; connectionId: string; credentialRef: string; pendingWriteName?: string }): Promise<void>
  forgetAllByUser(userId: string): Promise<void>
  forgetDisconnected(args: { userId: string; connectionId: string }): Promise<void>
  listByUser(userId: string): Promise<SubscriptionState[]>
}

export class ConvexSubscriptionRepository implements SubscriptionRepository {
  private readonly secret = getInternalApiSecret()

  async get(args: { userId: string; connectionId: string }) {
    return await convex.query<SubscriptionState | null>(
      'providers/subscriptions:getByServer',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async registerPendingWrite(args: { userId: string; connectionId: string; name: string }) {
    await convex.mutation(
      'providers/subscriptions:registerPendingWrite',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async clearPendingWrite(args: { userId: string; connectionId: string; name: string }) {
    await convex.mutation(
      'providers/subscriptions:clearPendingWrite',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async reserveAuthorization(args: {
    userId: string
    connectionId: string
    providerId: SubscriptionProviderId
    leaseToken: string
  }) {
    return requireMutationResult(await convex.mutation<{ generation: number; revision: number; cleanupRefs: string[] }>(
      'providers/subscriptions:reserveAuthorization',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async savePendingAuthorization(args: FencedArgs & { pendingStateRef: string; pendingWriteName?: string; expiresAt: number; pollIntervalMs: number }) {
    return requireMutationResult(await convex.mutation<{ revision: number; cleanupRefs: string[] }>(
      'providers/subscriptions:savePendingAuthorization',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async acquirePoll(args: { userId: string; connectionId: string; leaseToken: string }) {
    const result = requireMutationResult(await convex.mutation<{
      generation?: number
      revision?: number
      pendingStateRef?: string
      expiresAt?: number
      error?: string
    }>(
      'providers/subscriptions:acquirePoll',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
    if (result.error) throw new Error(result.error)
    if (result.generation === undefined || result.revision === undefined ||
        !result.pendingStateRef || result.expiresAt === undefined) {
      throw new Error('Subscription authorization is unavailable')
    }
    return {
      generation: result.generation,
      revision: result.revision,
      pendingStateRef: result.pendingStateRef,
      expiresAt: result.expiresAt,
    }
  }

  async releasePendingPoll(args: FencedArgs & { pollIntervalMs: number }) {
    await convex.mutation(
      'providers/subscriptions:releasePendingPoll',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async acquireRefresh(args: { userId: string; connectionId: string; leaseToken: string }) {
    const result = requireMutationResult(await convex.mutation<{
      generation?: number
      revision?: number
      credentialRef?: string
      providerId?: SubscriptionProviderId
      error?: string
    }>(
      'providers/subscriptions:acquireRefresh',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
    if (result.error) throw new Error(result.error)
    if (result.generation === undefined || result.revision === undefined ||
        !result.credentialRef || !result.providerId) {
      throw new Error('Subscription credential is unavailable')
    }
    return {
      generation: result.generation,
      revision: result.revision,
      credentialRef: result.credentialRef,
      providerId: result.providerId,
    }
  }

  async releaseRefresh(args: FencedArgs) {
    await convex.mutation(
      'providers/subscriptions:releaseRefresh',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async commitCredentialForDiscovery(args: FencedArgs & { credentialRef: string; pendingWriteName?: string }) {
    return requireMutationResult(await convex.mutation<{ revision: number; cleanupRefs: string[] }>(
      'providers/subscriptions:commitCredentialForDiscovery',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async acquireDiscovery(args: { userId: string; connectionId: string; leaseToken: string }) {
    const result = requireMutationResult(await convex.mutation<{
      generation?: number
      revision?: number
      credentialRef?: string
      providerId?: SubscriptionProviderId
      error?: string
    }>(
      'providers/subscriptions:acquireDiscovery',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
    if (result.error) throw new Error(result.error)
    if (result.generation === undefined || result.revision === undefined ||
        !result.credentialRef || !result.providerId) {
      throw new Error('Subscription credential is unavailable for discovery')
    }
    return {
      generation: result.generation,
      revision: result.revision,
      credentialRef: result.credentialRef,
      providerId: result.providerId,
    }
  }

  async releaseDiscovery(args: FencedArgs) {
    await convex.mutation(
      'providers/subscriptions:releaseDiscovery',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async commitActive(args: FencedArgs & { credentialRef: string; discoveredModelsJson: string; discoveredModelIds: string[]; displayName?: string }) {
    return requireMutationResult(await convex.mutation<{ revision: number; enabledModelIds: string[]; cleanupRefs: string[] }>(
      'providers/subscriptions:commitActive',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async failClosed(args: FencedArgs & { error: string }) {
    return requireMutationResult(await convex.mutation<string[]>(
      'providers/subscriptions:failClosed',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async disconnect(args: { userId: string; connectionId: string }) {
    return requireMutationResult(await convex.mutation<string[]>(
      'providers/subscriptions:disconnect',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    ))
  }

  async forDispatch(args: { userId: string; connectionId: string; modelId: string }) {
    return await convex.query<{ providerId: SubscriptionProviderId; credentialRef: string; generation: number } | null>(
      'providers/subscriptions:getForDispatchByServer',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async revokeAllByUser(userId: string) {
    return requireMutationResult(await convex.mutation<string[]>(
      'providers/subscriptions:revokeAllByUser',
      { serverSecret: this.secret, userId },
      { throwOnError: true },
    ))
  }

  async removeCleanupRef(args: { userId: string; connectionId: string; credentialRef: string }) {
    await convex.mutation(
      'providers/subscriptions:removeCleanupRef',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async retainCleanupRef(args: { userId: string; connectionId: string; credentialRef: string; pendingWriteName?: string }) {
    await convex.mutation(
      'providers/subscriptions:retainCleanupRef',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async forgetAllByUser(userId: string) {
    await convex.mutation(
      'providers/subscriptions:forgetAllByUser',
      { serverSecret: this.secret, userId },
      { throwOnError: true },
    )
  }

  async forgetDisconnected(args: { userId: string; connectionId: string }) {
    await convex.mutation(
      'providers/subscriptions:forgetDisconnectedByServer',
      { serverSecret: this.secret, ...args },
      { throwOnError: true },
    )
  }

  async listByUser(userId: string) {
    return await convex.query<SubscriptionState[]>(
      'providers/subscriptions:listByUserByServer',
      { serverSecret: this.secret, userId },
      { throwOnError: true },
    ) ?? []
  }
}
