import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { createSubscriptionService } from '@/server/ai/subscriptions/service'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import {
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import type { ProviderConnectionRecord } from '@/server/ai/provider-connections/ProviderConnectionRepository'
import {
  MAX_CONNECTIONS,
  fetchOwnedConnection,
  providerConnectionName,
  responseError,
} from './subscription-connection-helpers'

export type SubscriptionUpdateBody = Record<string, unknown> & {
  action: 'poll' | 'refresh' | 'callback'
}

function publicConnection(connection: ProviderConnectionRecord): ByokConnectionRow {
  return {
    _id: connection._id,
    providerId: connection.providerId,
    authKind: connection.authKind,
    subscriptionProvider: connection.subscriptionProvider,
    endpoint: connection.endpoint,
    displayName: connection.displayName,
    enabledModelIds: connection.enabledModelIds,
    discoveredModelsJson: connection.discoveredModelsJson,
    discoveredAt: connection.discoveredAt,
    status: connection.status,
    lastError: connection.lastError,
    lastTestedAt: connection.lastTestedAt,
    isDefault: connection.isDefault,
    isDeletable: connection.isDeletable,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

function connectedResponse(connection: ProviderConnectionRecord) {
  return NextResponse.json({
    data: { status: 'connected', connection: publicConnection(connection) },
  })
}

export async function startSubscriptionConnection(
  userId: string,
  providerId: SubscriptionProviderId,
  requestedConnectionId?: string,
) {
  const service = createSubscriptionService()
  if (!service.isEnabled(providerId)) {
    return responseError('This subscription request adapter is not available for this deployment', 404)
  }
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  let connectionId = requestedConnectionId
  let created = false
  if (connectionId) {
    const existing = await repository.get({ connectionId, userId })
    if (!existing || existing.authKind !== 'subscription' ||
        existing.subscriptionProvider !== providerId) {
      return responseError('Connection not found', 404)
    }
  } else {
    if (await repository.count({ userId }) >= MAX_CONNECTIONS) {
      return responseError('Provider connection limit reached', 409)
    }
    connectionId = await repository.create({
      userId,
      providerId: `subscription:${providerId}`,
      authKind: 'subscription',
      subscriptionProvider: providerId,
      endpoint: '',
      displayName: providerConnectionName(providerId),
      enabledModelIds: [],
      isDefault: false,
      isDeletable: true,
    })
    created = true
  }
  try {
    const authorization = await service.startAuthorization(userId, connectionId, providerId)
    return NextResponse.json({ data: { connectionId, authorization } })
  } catch (_error) {
    if (created) {
      try {
        await service.disconnect(userId, connectionId)
        await repository.remove({ userId, connectionId })
      } catch (_cleanupError) {
        // Keep the connection row reachable so failed or in-flight cleanup can be retried.
      }
    }
    return responseError('Could not start subscription authorization. Retry or contact support.', 503)
  }
}

export async function executeSubscriptionUpdate(
  userId: string,
  connectionId: string,
  body: SubscriptionUpdateBody,
) {
  if (body.action === 'callback') return responseError('This subscription action is unavailable', 400)
  const service = createSubscriptionService()
  const existing = await fetchOwnedConnection(userId, connectionId)
  if (!existing || existing.authKind !== 'subscription') {
    return responseError('Connection not found', 404)
  }
  try {
    if (body.action === 'poll' && existing.status === 'active') {
      return connectedResponse(existing)
    }
    const result = body.action === 'poll'
      ? await service.poll(userId, connectionId)
      : await service.refresh(userId, connectionId)
    if (result.status === 'connected') {
      const connection = await fetchOwnedConnection(userId, connectionId)
      if (!connection || connection.authKind !== 'subscription' || connection.status !== 'active') {
        return responseError('Subscription connection is not ready yet. Retry shortly.', 503)
      }
      return connectedResponse(connection)
    }
    return NextResponse.json({ data: result })
  } catch (error) {
    const latest = body.action === 'poll'
      ? await fetchOwnedConnection(userId, connectionId).catch((_readError) => null)
      : null
    if (latest?.authKind === 'subscription' && latest.status === 'active') {
      return connectedResponse(latest)
    }
    if (body.action === 'poll' && error instanceof Error &&
        ['Subscription poll is not due', 'Subscription connection is busy'].includes(error.message)) {
      return NextResponse.json({ data: { status: 'pending' } })
    }
    return responseError('The subscription operation failed. Retry or reconnect.', 503)
  }
}
