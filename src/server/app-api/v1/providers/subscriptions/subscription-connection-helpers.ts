import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  subscriptionProvider,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'

export const MAX_CONNECTIONS = 20
export const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/
const modelOperations = new Map<string, Promise<void>>()

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function lockKey(userId: string, connectionId: string) {
  return `${userId}\0${connectionId}`
}

export async function withConnectionLock<T>(
  userId: string,
  connectionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = lockKey(userId, connectionId)
  const previous = modelOperations.get(key) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  const current = previous.then(() => next)
  modelOperations.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (modelOperations.get(key) === current) modelOperations.delete(key)
  }
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
