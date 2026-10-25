import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  subscriptionBrokerRequest,
} from '@/server/ai/gateway/subscription-broker'
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

export async function updateConnectedMetadata(
  userId: string,
  connectionId: string,
  providerId: SubscriptionProviderId,
  models: unknown,
  previousEnabled?: string[],
) {
  const candidates = Array.isArray(models) ? models : []
  const seen = new Set<string>()
  const discovered = candidates.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return []
    const id = model.id.trim()
    if (!/^[A-Za-z0-9._~:/@+-]{1,100}$/.test(id) || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      name: typeof model.name === 'string' ? model.name.slice(0, 200) : id,
    }]
  }).slice(0, 400)
  if (discovered.length === 0) {
    throw new Error('The connected provider did not expose any supported models')
  }
  const discoveredIds = new Set(discovered.map((model) => model.id))
  const enabledModelIds = previousEnabled
    ? previousEnabled.filter((id) => discoveredIds.has(id))
    : discovered.map((model) => model.id)
  await subscriptionBrokerRequest('/v1/subscriptions/models', {
    ownerId: userId,
    connectionId,
    providerId,
    enabledModelIds,
  })
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  await repository.update({
    connectionId,
    userId,
    enabledModelIds,
    discoveredModelsJson: JSON.stringify({ data: discovered }),
    discoveredAt: Date.now(),
    status: 'active',
    lastError: '',
    lastTestedAt: Date.now(),
  })
  return await repository.get({ connectionId, userId })
}
