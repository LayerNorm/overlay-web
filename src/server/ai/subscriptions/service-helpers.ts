import { SUBSCRIPTION_PROVIDERS, type SubscriptionProviderId } from '@/shared/ai/gateway/subscription-providers'
import {
  isBridgeCredential,
  isBridgePendingState,
  SubscriptionBridgeError,
  type BridgeCredential,
  type BridgePendingState,
} from './bridge-client'

const implementedProviders = new Set<SubscriptionProviderId>(SUBSCRIPTION_PROVIDERS.map(({ id }) => id))

export const credentialPurpose = 'subscription-credential' as const
export const pendingWriteStaleAgeMs = 5 * 60_000

export type WrittenSecret = {
  ref: string
  name: string
}

type DispatchAuthorization = {
  providerId: string
  credentialRef: string
  ownerUserId: string
  generation: number
  revision: number
}

type DispatchState = {
  userId: string
  providerId: string
  generation: number
  revision: number
}

export function parsePendingState(value: string): BridgePendingState | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isBridgePendingState(parsed) ? parsed : null
  } catch (_error) {
    return null
  }
}

export function parseCredential(value: string): BridgeCredential | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isBridgeCredential(parsed) ? parsed : null
  } catch (_error) {
    return null
  }
}

export function allowedProviders(bridgeConfigured: boolean): SubscriptionProviderId[] {
  const configured = new Set(
    (process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS ?? '')
      .split(',')
      .map((provider) => provider.trim()),
  )
  if (!bridgeConfigured) return []
  return SUBSCRIPTION_PROVIDERS
    .filter(({ id }) => implementedProviders.has(id) && configured.has(id))
    .map(({ id }) => id)
}

export function publicError(error: unknown): string {
  if (error instanceof SubscriptionBridgeError &&
      ['reconnect_required', 'model_unavailable', 'rate_limited', 'provider_unavailable',
        'temporary_failure', 'invalid_callback']
        .includes(error.code)) return error.message
  if (error instanceof Error && error.message.startsWith('Reconnect your subscription')) return error.message
  if (error instanceof Error && error.message.startsWith('Subscriptions are unavailable')) return error.message
  return 'The subscription operation failed. Retry or reconnect.'
}

export function dispatchStateMatches(state: DispatchState, authorization: DispatchAuthorization): boolean {
  return state.userId === authorization.ownerUserId &&
    state.providerId === authorization.providerId &&
    state.generation === authorization.generation &&
    state.revision === authorization.revision
}

export function dispatchAuthorizationMatches(
  expected: DispatchAuthorization,
  refreshed: DispatchAuthorization | null,
): refreshed is DispatchAuthorization {
  return Boolean(refreshed &&
    refreshed.ownerUserId === expected.ownerUserId &&
    refreshed.providerId === expected.providerId &&
    refreshed.generation === expected.generation)
}

export function sameDispatchAuthorization(
  expected: DispatchAuthorization,
  actual: DispatchAuthorization | null,
): actual is DispatchAuthorization {
  return Boolean(actual &&
    actual.ownerUserId === expected.ownerUserId &&
    actual.providerId === expected.providerId &&
    actual.generation === expected.generation &&
    actual.revision === expected.revision &&
    actual.credentialRef === expected.credentialRef)
}

export function isCredentialNearExpiry(credential: BridgeCredential): boolean {
  return !credential.nonExpiring && credential.expiresAt !== null &&
    credential.expiresAt <= Date.now() + 60_000
}

export function isDispatchCredentialUsable(
  credential: BridgeCredential,
  providerId: string,
): boolean {
  return credential.providerId === providerId &&
    (credential.nonExpiring || (credential.expiresAt !== null && credential.expiresAt > Date.now()))
}
