import type { SubscriptionProviderId } from '@/shared/ai/gateway/subscription-providers'

export type SubscriptionPhase = 'pending' | 'discovering' | 'active' | 'needs_reconnect' | 'disconnected'
export type SubscriptionLeaseOperation = 'authorization' | 'poll' | 'refresh' | 'discovery'

export type SubscriptionState = {
  _id: string
  userId: string
  connectionId: string
  providerId: SubscriptionProviderId
  generation: number
  revision: number
  phase: SubscriptionPhase
  credentialRef?: string
  pendingStateRef?: string
  nextPollAt?: number
  expiresAt?: number
  leaseToken?: string
  leaseUntil?: number
  leaseOperation?: SubscriptionLeaseOperation
  cleanupRefs: string[]
  cleanupStatus: 'clean' | 'pending'
  pendingWrites?: Array<{ name: string; createdAt: number }>
}

export type SubscriptionModel = {
  id: string
  name: string
}

export type SubscriptionAuthorization = {
  url: string
  userCode?: string
  expiresAt: number
  interval: number
}

export type SubscriptionResult =
  | { status: 'pending' }
  | { status: 'connected'; models: SubscriptionModel[] }
  | { status: 'expired' }
  | { status: 'error'; error: string }
