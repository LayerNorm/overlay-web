import 'server-only'

import { randomUUID } from 'node:crypto'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import {
  isSubscriptionProviderId,
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import {
  SubscriptionBridgeClient,
  SubscriptionBridgeError,
  type BridgeCredential,
  type BridgePendingState,
} from './bridge-client'
import { ConvexSubscriptionRepository, type SubscriptionRepository } from './repository'
import type {
  SubscriptionAuthorization,
  SubscriptionResult,
} from './types'
import {
  allowedProviders,
  credentialPurpose,
  dispatchAuthorizationMatches,
  dispatchStateMatches,
  isCredentialNearExpiry,
  isDispatchCredentialUsable,
  parseCredential,
  parsePendingState,
  pendingWriteStaleAgeMs,
  publicError,
  sameDispatchAuthorization,
  type WrittenSecret,
} from './service-helpers'

export class SubscriptionService {
  private readonly bridge: SubscriptionBridgeClient

  constructor(
    private readonly repository: SubscriptionRepository = new ConvexSubscriptionRepository(),
    private readonly credentials: ByokCredentialStore = getOverlayServerContext().byokCredentialStore,
    private readonly fetcher: typeof fetch = fetch,
    bridge?: SubscriptionBridgeClient,
  ) {
    this.bridge = bridge ?? new SubscriptionBridgeClient(undefined, undefined, fetcher)
  }

  providers() {
    const enabled = new Set(allowedProviders(this.bridge.isConfigured()))
    return {
      available: enabled.size > 0,
      providers: SUBSCRIPTION_PROVIDERS.map(({ id, label, description }) => ({
        id, label, description, enabled: enabled.has(id),
      })),
      ...(!enabled.size ? { reason: 'No implemented subscription request adapter is enabled for this deployment.' } : {}),
    }
  }

  isEnabled(providerId: unknown): providerId is SubscriptionProviderId {
    return isSubscriptionProviderId(providerId) &&
      allowedProviders(this.bridge.isConfigured()).includes(providerId)
  }

  async startAuthorization(
    userId: string,
    connectionId: string,
    providerId: SubscriptionProviderId,
  ): Promise<SubscriptionAuthorization> {
    await this.reconcilePendingWrites(userId, connectionId, { olderThanMs: pendingWriteStaleAgeMs })
    if (!this.isEnabled(providerId)) throw new Error('Subscription request adapter is not available')
    const leaseToken = randomUUID()
    const lease = await this.repository.reserveAuthorization({
      userId, connectionId, providerId, leaseToken,
    })
    let candidate: WrittenSecret | undefined
    try {
      const device = await this.bridge.authorize(providerId)
      const pending = device.pendingState
      const written = await this.writeSecret(userId, connectionId, providerId, JSON.stringify(pending))
      candidate = written
      try {
        const saved = await this.repository.savePendingAuthorization({
          userId, connectionId,
          generation: lease.generation,
          revision: lease.revision,
          leaseToken,
          pendingStateRef: written.ref,
          pendingWriteName: written.name,
          expiresAt: device.authorization.expiresAt,
          pollIntervalMs: device.authorization.interval * 1000,
        })
        await this.cleanupRefs(userId, connectionId, saved.cleanupRefs)
      } catch (error) {
        await this.deleteCandidateIfUncommitted(userId, connectionId, written)
        throw error
      }
      return {
        url: device.authorization.url,
        userCode: device.authorization.userCode,
        expiresAt: device.authorization.expiresAt,
        interval: device.authorization.interval,
        callbackRequired: device.authorization.callbackRequired,
      }
    } catch (error) {
      if (candidate) await this.deleteCandidateIfUncommitted(userId, connectionId, candidate)
      await this.repository.failClosed({
        userId, connectionId, generation: lease.generation, revision: lease.revision,
        leaseToken, error: 'Authorization could not be started. Reconnect to continue.',
      }).catch((_error) => undefined)
      throw new Error(publicError(error))
    }
  }

  async poll(
    userId: string,
    connectionId: string,
    callbackUrl?: string,
  ): Promise<SubscriptionResult> {
    if (callbackUrl !== undefined && (callbackUrl.length === 0 || callbackUrl.length > 8192)) {
      return { status: 'error', error: 'Invalid authorization callback.', retryable: true }
    }
    await this.reconcilePendingWrites(userId, connectionId, { olderThanMs: pendingWriteStaleAgeMs })
    const current = await this.repository.get({ userId, connectionId })
    if (current?.phase === 'active') return { status: 'connected', models: [] }
    if (current?.phase === 'discovering') return await this.discover(userId, connectionId)
    const leaseToken = randomUUID()
    const lease = await this.repository.acquirePoll({
      userId, connectionId, leaseToken, callbackMode: callbackUrl !== undefined,
    })
    const fenced = {
      userId, connectionId, generation: lease.generation,
      revision: lease.revision, leaseToken,
    }
    const providerId = lease.providerId
    let pending: BridgePendingState | null = null
    try {
      const secret = await this.credentials.read(lease.pendingStateRef)
      pending = secret ? parsePendingState(secret) : null
      if (!pending) throw new Error('Subscription authorization state is unavailable')
      if (!providerId || pending.providerId !== providerId) throw new Error('Subscription authorization provider does not match')
      if (lease.pollIntervalMs !== undefined) {
        pending.interval = Math.max(1, Math.min(1800, Math.ceil(lease.pollIntervalMs / 1000)))
      }
      if (pending.expiresAt <= Date.now()) {
        await this.repository.failClosed({ ...fenced, error: 'Authorization expired. Reconnect to continue.' })
        return { status: 'expired' }
      }
      if (pending.callbackRequired && !callbackUrl) {
        await this.repository.releasePendingPoll({
          ...fenced,
          pollIntervalMs: pending.interval * 1000,
        })
        return { status: 'pending' }
      }
      const result = pending.callbackRequired
        ? await this.bridge.complete(pending, callbackUrl!)
        : await this.bridge.poll(pending)
      if (result.status === 'pending') {
        await this.repository.releasePendingPoll({
          ...fenced,
          pollIntervalMs: (result.pendingState?.interval ?? pending.interval) * 1000,
        })
        return { status: 'pending' }
      }
      if (!result.credential || !parseCredential(JSON.stringify(result.credential)) ||
          result.credential.providerId !== providerId) {
        throw new Error('Subscription credential is unavailable')
      }
      const candidate = await this.writeSecret(
        userId, connectionId, providerId, JSON.stringify(result.credential),
      )
      const committed = await this.commitCredentialCandidate(fenced, candidate)
      if (!committed) throw new Error('Authorization could not be committed')
      return await this.discover(userId, connectionId)
    } catch (error) {
      if (pending && error instanceof SubscriptionBridgeError &&
          ['invalid_callback', 'rate_limited', 'provider_unavailable', 'temporary_failure']
            .includes(error.code)) {
        await this.repository.releasePendingPoll({
          ...fenced,
          pollIntervalMs: pending.interval * 1000,
        }).catch((_releaseError) => undefined)
        return { status: 'error', error: publicError(error), retryable: true }
      }
      await this.repository.failClosed({
        ...fenced,
        error: 'Subscription authorization could not be completed. Reconnect to continue.',
      }).catch((_error) => undefined)
      return { status: 'error', error: publicError(error) }
    }
  }

  async refresh(userId: string, connectionId: string): Promise<SubscriptionResult> {
    await this.reconcilePendingWrites(userId, connectionId, { olderThanMs: pendingWriteStaleAgeMs })
    const state = await this.repository.get({ userId, connectionId })
    if (state?.phase === 'discovering') return await this.discover(userId, connectionId)
    if (state?.phase !== 'active' || !state.credentialRef) {
      throw new Error('Subscription credential is unavailable')
    }
    const leaseToken = randomUUID()
    const lease = await this.repository.acquireRefresh({ userId, connectionId, leaseToken })
    const fenced = {
      userId, connectionId, generation: lease.generation,
      revision: lease.revision, leaseToken,
    }
    try {
      const latestSecret = await this.credentials.read(lease.credentialRef)
      const latest = latestSecret ? parseCredential(latestSecret) : null
      if (!latest) throw new Error('Subscription credential is unavailable')
      if (latest.providerId !== lease.providerId) throw new Error('Subscription credential provider does not match')
      if (latest.nonExpiring || latest.expiresAt === null || latest.expiresAt > Date.now() + 60_000) {
        await this.repository.releaseRefresh(fenced)
        return await this.discover(userId, connectionId)
      }
      const refreshed = await this.bridge.refresh(latest)
      if (refreshed.credential.providerId !== lease.providerId) throw new Error('Refreshed provider does not match')
      const candidate = await this.writeSecret(userId, connectionId, lease.providerId, JSON.stringify(refreshed.credential))
      const committed = await this.commitCredentialCandidate(fenced, candidate)
      if (!committed) throw new Error('Refreshed subscription credential could not be committed')
      return await this.discover(userId, connectionId)
    } catch (error) {
      if (error instanceof SubscriptionBridgeError &&
          ['rate_limited', 'provider_unavailable', 'temporary_failure'].includes(error.code)) {
        await this.repository.releaseRefresh(fenced).catch((_releaseError) => undefined)
        return { status: 'error', error: publicError(error) }
      }
      await this.repository.failClosed({
        ...fenced,
        error: 'The rotating subscription credential could not be refreshed. Reconnect to continue.',
      }).catch((_error) => undefined)
      return { status: 'error', error: publicError(error) }
    }
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    const refs = await this.repository.disconnect({ userId, connectionId })
    const refsCleaned = await this.cleanupRefs(userId, connectionId, refs)
    const pendingWritesCleaned = await this.reconcilePendingWrites(userId, connectionId, { olderThanMs: 0 })
    if (!refsCleaned || !pendingWritesCleaned) {
      throw new Error('Subscription cleanup is pending')
    }
    await this.repository.forgetDisconnected({ userId, connectionId })
  }

  async credentialForDispatch(
    actorUserId: string,
    connectionId: string,
    modelId: string,
    workspaceId?: string,
  ): Promise<BridgeCredential> {
    const authorized = await this.repository.forDispatch({
      actorUserId, workspaceId, connectionId, modelId,
    })
    if (!authorized || !this.isEnabled(authorized.providerId)) {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    const userId = authorized.ownerUserId
    const state = await this.repository.get({ userId, connectionId })
    if (!state || !dispatchStateMatches(state, authorized)) {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    let currentAuthorization = authorized
    let credential = await this.readDispatchCredential(currentAuthorization)
    if (isCredentialNearExpiry(credential)) {
      const refreshed = await this.refresh(userId, connectionId)
      if (refreshed.status !== 'connected') {
        throw new Error(refreshed.status === 'error' ? refreshed.error : 'Reconnect your subscription to continue.')
      }
      const refreshedAuthorization = await this.repository.forDispatch({
        actorUserId, workspaceId, connectionId, modelId,
      })
      if (!dispatchAuthorizationMatches(authorized, refreshedAuthorization)) {
        throw new Error('Subscription connection is unavailable or this model is not enabled.')
      }
      currentAuthorization = refreshedAuthorization
      credential = await this.readDispatchCredential(currentAuthorization)
      if (!isDispatchCredentialUsable(credential, currentAuthorization.providerId)) {
        throw new Error('Reconnect your subscription to continue.')
      }
    }
    const revalidated = await this.repository.forDispatch({
      actorUserId, workspaceId, connectionId, modelId,
    })
    if (!sameDispatchAuthorization(currentAuthorization, revalidated)) {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    return credential
  }

  private async readDispatchCredential(
    authorized: NonNullable<Awaited<ReturnType<SubscriptionRepository['forDispatch']>>>,
  ): Promise<BridgeCredential> {
    const secret = await this.credentials.read(authorized.credentialRef)
    const credential = secret ? parseCredential(secret) : null
    if (!credential || credential.providerId !== authorized.providerId) {
      throw new Error('Reconnect your subscription to continue.')
    }
    return credential
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.revokeAllByUser(userId)
    const states = await this.repository.listByUser(userId)
    let cleanupSucceeded = true
    for (const state of states) {
      if (!await this.cleanupRefs(userId, state.connectionId, state.cleanupRefs)) cleanupSucceeded = false
      if (!await this.reconcilePendingWrites(userId, state.connectionId, { olderThanMs: 0 })) cleanupSucceeded = false
    }
    if (!cleanupSucceeded) throw new Error('Subscription cleanup is pending')
    await this.repository.forgetAllByUser(userId)
  }

  private async discover(userId: string, connectionId: string): Promise<SubscriptionResult> {
    const leaseToken = randomUUID()
    const lease = await this.repository.acquireDiscovery({ userId, connectionId, leaseToken })
    const fenced = {
      userId, connectionId, generation: lease.generation,
      revision: lease.revision, leaseToken,
    }
    try {
      const secret = await this.credentials.read(lease.credentialRef)
      const credential = secret ? parseCredential(secret) : null
      if (!credential || credential.providerId !== lease.providerId) {
        throw new Error('Reconnect your subscription to continue.')
      }
      const catalog = await this.bridge.models(credential)
      const models = catalog.models
      const saved = await this.repository.commitActive({
        ...fenced,
        credentialRef: lease.credentialRef,
        discoveredModelsJson: JSON.stringify({ data: models }),
        discoveredModelIds: models.map((model) => model.id),
        displayName: credential.displayName,
      })
      await this.cleanupRefs(userId, connectionId, saved.cleanupRefs)
      return { status: 'connected', models }
    } catch (error) {
      await this.repository.releaseDiscovery(fenced).catch((_error) => undefined)
      return { status: 'error', error: publicError(error) }
    }
  }

  private async commitCredentialCandidate(
    fenced: { userId: string; connectionId: string; generation: number; revision: number; leaseToken: string },
    candidate: WrittenSecret,
  ): Promise<boolean> {
    const { ref: credentialRef, name: pendingWriteName } = candidate
    try {
      const result = await this.repository.commitCredentialForDiscovery({
        ...fenced, credentialRef, pendingWriteName,
      })
      await this.cleanupRefs(fenced.userId, fenced.connectionId, result.cleanupRefs)
      return true
    } catch (_error) {
      let state: Awaited<ReturnType<SubscriptionRepository['get']>>
      try {
        state = await this.repository.get({
          userId: fenced.userId,
          connectionId: fenced.connectionId,
        })
      } catch (_error) {
        try {
          await this.repository.retainCleanupRef({
            userId: fenced.userId, connectionId: fenced.connectionId, credentialRef, pendingWriteName,
          })
        } catch (_retainError) { /* retain the original failure */ }
        return false
      }
      if (state?.credentialRef === credentialRef ||
          state?.pendingStateRef === credentialRef ||
          state?.cleanupRefs.includes(credentialRef)) return true
      await this.deleteCandidateIfUncommitted(fenced.userId, fenced.connectionId, candidate)
      return false
    }
  }

  private async deleteCandidateIfUncommitted(
    userId: string,
    connectionId: string,
    candidate: WrittenSecret,
  ): Promise<void> {
    const { ref: candidateRef, name: pendingWriteName } = candidate
    let state: Awaited<ReturnType<SubscriptionRepository['get']>>
    try {
      state = await this.repository.get({ userId, connectionId })
    } catch (_error) {
      try {
        await this.repository.retainCleanupRef({
          userId, connectionId, credentialRef: candidateRef, pendingWriteName,
        })
      } catch (_retainError) { /* retain the original failure */ }
      return
    }
    if (state?.credentialRef === candidateRef || state?.pendingStateRef === candidateRef) return
    if (state?.cleanupRefs.includes(candidateRef)) return
    try {
      await this.credentials.delete(candidateRef)
      await this.repository.clearPendingWrite({ userId, connectionId, name: pendingWriteName })
    } catch (_error) {
      try {
        await this.repository.retainCleanupRef({
          userId, connectionId, credentialRef: candidateRef, pendingWriteName,
        })
      } catch (_retainError) { /* retain the original failure */ }
    }
  }

  private async reconcilePendingWrites(
    userId: string,
    connectionId: string,
    { olderThanMs }: { olderThanMs: number },
  ): Promise<boolean> {
    let state: Awaited<ReturnType<SubscriptionRepository['get']>>
    try {
      state = await this.repository.get({ userId, connectionId })
    } catch (_error) {
      return false
    }
    if (!state) return true

    if (state.leaseUntil !== undefined && state.leaseUntil > Date.now()) {
      return (state.pendingWrites?.length ?? 0) === 0
    }

    const cutoff = Date.now() - olderThanMs
    let succeeded = true
    for (const pendingWrite of state.pendingWrites ?? []) {
      if (pendingWrite.createdAt > cutoff) continue
      try {
        await this.credentials.deleteByName(pendingWrite.name)
        await this.repository.clearPendingWrite({
          userId, connectionId, name: pendingWrite.name,
        })
      } catch (_error) {
        succeeded = false
      }
    }
    return succeeded
  }

  private async cleanupRefs(userId: string, connectionId: string, refs: string[]): Promise<boolean> {
    let success = true
    for (const credentialRef of refs) {
      try {
        await this.credentials.delete(credentialRef)
        await this.repository.removeCleanupRef({ userId, connectionId, credentialRef })
      } catch (_error) {
        success = false
      }
    }
    return success
  }

  private async writeSecret(
    userId: string,
    connectionId: string,
    providerId: SubscriptionProviderId,
    value: string,
  ): Promise<WrittenSecret> {
    const name = this.credentials.newCredentialName()
    await this.repository.registerPendingWrite({ userId, connectionId, name })
    try {
      const ref = await this.credentials.write({
        name,
        apiKey: value,
        context: {
          purpose: credentialPurpose,
          userId,
          connectionId,
          providerId: `subscription-${providerId}`,
        },
      })
      return { ref, name }
    } catch (error) {
      try {
        await this.credentials.deleteByName(name)
        await this.repository.clearPendingWrite({ userId, connectionId, name })
      } catch (_cleanupError) { /* leave the pending name for reconciliation */ }
      throw error
    }
  }

}

export function createSubscriptionService(): SubscriptionService {
  return new SubscriptionService()
}

export async function deleteAllSubscriptionCredentials(userId: string): Promise<void> {
  await createSubscriptionService().revokeAllForUser(userId)
}
