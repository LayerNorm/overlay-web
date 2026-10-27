import 'server-only'

import { randomUUID } from 'node:crypto'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import {
  codexAccessTokenExpiry,
  codexTokensNeedRefresh,
  CodexSignInError,
  parseCodexTokens,
  pollCodexDeviceCode,
  refreshCodexTokens,
  requestCodexDeviceCode,
  serializeCodexTokens,
  type CodexTokenSet,
} from '@/server/agents/provider-accounts/codex-subscription'
import {
  isSubscriptionProviderId,
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import { discoverCodexModels } from './codex-discovery'
import { ConvexSubscriptionRepository, type SubscriptionRepository } from './repository'
import type {
  SubscriptionAuthorization,
  SubscriptionResult,
} from './types'

const implementedProviders = new Set<SubscriptionProviderId>(['codex'])
const credentialPurpose = 'subscription-credential' as const
const pendingWriteStaleAgeMs = 5 * 60_000

type WrittenSecret = {
  ref: string
  name: string
}

type PendingCodexState = {
  v: 1
  deviceAuthId: string
  userCode: string
  interval: number
}

function parsePendingState(value: string): PendingCodexState | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || !('v' in parsed) ||
        parsed.v !== 1 || !('deviceAuthId' in parsed) ||
        typeof parsed.deviceAuthId !== 'string' || !('userCode' in parsed) ||
        typeof parsed.userCode !== 'string' || !('interval' in parsed) ||
        typeof parsed.interval !== 'number') return null
    return parsed as PendingCodexState
  } catch (_error) {
    return null
  }
}

function allowedProviders(): SubscriptionProviderId[] {
  const configured = new Set(
    (process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS ?? '')
      .split(',')
      .map((provider) => provider.trim()),
  )
  return SUBSCRIPTION_PROVIDERS
    .filter(({ id }) => implementedProviders.has(id) && configured.has(id))
    .map(({ id }) => id)
}

function publicError(error: unknown): string {
  if (error instanceof CodexSignInError) {
    switch (error.code) {
      case 'pending': return 'Waiting for authorization approval.'
      case 'expired': return 'Authorization expired. Reconnect to continue.'
      case 'denied':
      case 'rejected': return 'Authorization was rejected. Reconnect to continue.'
      case 'unsupported': return 'Codex subscription authorization is unavailable.'
      default: return 'Codex authorization could not be completed. Retry or reconnect.'
    }
  }
  return 'The subscription operation failed. Retry or reconnect.'
}

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository = new ConvexSubscriptionRepository(),
    private readonly credentials: ByokCredentialStore = getOverlayServerContext().byokCredentialStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  providers() {
    const enabled = new Set(allowedProviders())
    return {
      available: enabled.size > 0,
      providers: SUBSCRIPTION_PROVIDERS.map(({ id, label, description }) => ({
        id, label, description, enabled: enabled.has(id),
      })),
      ...(!enabled.size ? { reason: 'No implemented subscription request adapter is enabled for this deployment.' } : {}),
    }
  }

  isEnabled(providerId: unknown): providerId is SubscriptionProviderId {
    return isSubscriptionProviderId(providerId) && allowedProviders().includes(providerId)
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
      const device = await requestCodexDeviceCode({
        fetch: this.codexFetch(),
      })
      const pending: PendingCodexState = {
        v: 1,
        deviceAuthId: device.deviceAuthId,
        userCode: device.userCode,
        interval: device.interval,
      }
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
          expiresAt: device.expiresAt,
          pollIntervalMs: device.interval * 1000,
        })
        await this.cleanupRefs(userId, connectionId, saved.cleanupRefs)
      } catch (error) {
        await this.deleteCandidateIfUncommitted(userId, connectionId, written)
        throw error
      }
      return {
        url: device.verificationUrl,
        userCode: device.userCode,
        expiresAt: device.expiresAt,
        interval: device.interval,
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

  async poll(userId: string, connectionId: string): Promise<SubscriptionResult> {
    await this.reconcilePendingWrites(userId, connectionId, { olderThanMs: pendingWriteStaleAgeMs })
    const current = await this.repository.get({ userId, connectionId })
    if (current?.phase === 'active') return { status: 'connected', models: [] }
    if (current?.phase === 'discovering') return await this.discover(userId, connectionId)
    const leaseToken = randomUUID()
    const lease = await this.repository.acquirePoll({ userId, connectionId, leaseToken })
    const fenced = {
      userId, connectionId, generation: lease.generation,
      revision: lease.revision, leaseToken,
    }
    let pending: PendingCodexState | null = null
    try {
      const secret = await this.credentials.read(lease.pendingStateRef)
      pending = secret ? parsePendingState(secret) : null
      if (!pending) throw new Error('Subscription authorization state is unavailable')
      const tokens = await pollCodexDeviceCode({
        deviceAuthId: pending.deviceAuthId,
        userCode: pending.userCode,
      }, { fetch: this.codexFetch() })
      const expiry = codexAccessTokenExpiry(tokens)
      if (!expiry || expiry <= Date.now()) throw new Error('Codex returned an expired subscription token')
      const candidate = await this.writeSecret(
        userId, connectionId, 'codex', serializeCodexTokens(tokens),
      )
      const committed = await this.commitCredentialCandidate(fenced, candidate)
      if (!committed) throw new Error('Authorization could not be committed')
      return await this.discover(userId, connectionId)
    } catch (error) {
      if (error instanceof CodexSignInError && error.code === 'pending') {
        if (!pending) return { status: 'error', error: 'Subscription authorization state is unavailable' }
        await this.repository.releasePendingPoll({
          ...fenced,
          pollIntervalMs: pending.interval * 1000,
        })
        return { status: 'pending' }
      }
      if (error instanceof CodexSignInError && error.code === 'expired') {
        await this.repository.failClosed({ ...fenced, error: 'Codex authorization expired. Reconnect to continue.' })
        return { status: 'expired' }
      }
      await this.repository.failClosed({
        ...fenced,
        error: 'Codex authorization could not be completed. Reconnect to continue.',
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
    const currentSecret = await this.credentials.read(state.credentialRef)
    const current = currentSecret ? parseCodexTokens(currentSecret) : null
    if (!current) throw new Error('Subscription credential is unavailable')
    if (!codexTokensNeedRefresh(current, Date.now())) {
      return await this.discover(userId, connectionId)
    }
    const leaseToken = randomUUID()
    const lease = await this.repository.acquireRefresh({ userId, connectionId, leaseToken })
    const fenced = {
      userId, connectionId, generation: lease.generation,
      revision: lease.revision, leaseToken,
    }
    try {
      const latestSecret = await this.credentials.read(lease.credentialRef)
      const latest = latestSecret ? parseCodexTokens(latestSecret) : null
      if (!latest) throw new Error('Subscription credential is unavailable')
      if (!codexTokensNeedRefresh(latest, Date.now())) {
        await this.repository.releaseRefresh(fenced)
        return { status: 'connected', models: [] }
      }
      const refreshed = await refreshCodexTokens(latest, { fetch: this.codexFetch() })
      const candidate = await this.writeSecret(userId, connectionId, 'codex', serializeCodexTokens(refreshed))
      const committed = await this.commitCredentialCandidate(fenced, candidate)
      if (!committed) throw new Error('Refreshed subscription credential could not be committed')
      return await this.discover(userId, connectionId)
    } catch (error) {
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
    userId: string,
    connectionId: string,
    modelId: string,
  ): Promise<CodexTokenSet> {
    if (!this.isEnabled('codex')) throw new Error('Subscription request adapter is not available')
    let authorized = await this.repository.forDispatch({ userId, connectionId, modelId })
    if (!authorized || authorized.providerId !== 'codex') {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    const secret = await this.credentials.read(authorized.credentialRef)
    let tokens = secret ? parseCodexTokens(secret) : null
    if (!tokens) throw new Error('Subscription credential is unavailable')
    if (codexTokensNeedRefresh(tokens, Date.now())) {
      await this.refresh(userId, connectionId)
      authorized = await this.repository.forDispatch({ userId, connectionId, modelId })
      if (!authorized || authorized.providerId !== 'codex') {
        throw new Error('Subscription connection is unavailable or this model is not enabled.')
      }
      const refreshedSecret = await this.credentials.read(authorized.credentialRef)
      tokens = refreshedSecret ? parseCodexTokens(refreshedSecret) : null
      if (!tokens || codexTokensNeedRefresh(tokens, Date.now())) {
        throw new Error('Subscription credential is unavailable')
      }
    }
    const revalidated = await this.repository.forDispatch({ userId, connectionId, modelId })
    if (!revalidated || revalidated.providerId !== 'codex' ||
        revalidated.generation !== authorized.generation ||
        revalidated.credentialRef !== authorized.credentialRef) {
      throw new Error('Subscription connection is unavailable or this model is not enabled.')
    }
    return tokens
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
      const tokens = secret ? parseCodexTokens(secret) : null
      if (!tokens) throw new Error('Subscription credential is unavailable')
      const models = await discoverCodexModels(tokens, { fetch: this.fetcher })
      const saved = await this.repository.commitActive({
        ...fenced,
        credentialRef: lease.credentialRef,
        discoveredModelsJson: JSON.stringify({ data: models }),
        discoveredModelIds: models.map((model) => model.id),
        displayName: tokens.plan ? `ChatGPT ${tokens.plan}` : undefined,
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

  private codexFetch() {
    const deadline = Date.now() + 25_000
    return async (url: string, init: Parameters<typeof fetch>[1]) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('Subscription provider request deadline exceeded')
      const timeout = AbortSignal.timeout(Math.min(remaining, 10_000))
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
      const response = await this.fetcher(url, {
        ...init,
        signal,
        redirect: 'error',
        cache: 'no-store',
      })
      return response
    }
  }
}

export function createSubscriptionService(): SubscriptionService {
  return new SubscriptionService()
}

export async function deleteAllSubscriptionCredentials(userId: string): Promise<void> {
  await createSubscriptionService().revokeAllForUser(userId)
}
