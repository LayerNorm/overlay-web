import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  subscriptionProvider,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'

export const MAX_CONNECTIONS = 20
export const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export function providerConnectionName(providerId: SubscriptionProviderId) {
  return `${subscriptionProvider(providerId).label} subscription`
}

export async function fetchOwnedConnection(userId: string, connectionId: string) {
  return await getOverlayServerContext().appData.repositories.providerConnections.get({
    connectionId,
    userId,
  })
}
