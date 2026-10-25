import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { createSubscriptionService } from '@/server/ai/subscriptions/service'
import {
  isSubscriptionConnection,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import {
  MAX_CONNECTIONS,
  fetchOwnedConnection,
  providerConnectionName,
  responseError,
} from './subscription-connection-helpers'

export type SubscriptionUpdateBody = Record<string, unknown> & {
  action: 'poll' | 'refresh' | 'callback'
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
    if (!existing || !isSubscriptionConnection(existing) ||
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
      await repository.remove({ userId, connectionId }).catch((_removeError) => undefined)
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
  try {
    const service = createSubscriptionService()
    const result = body.action === 'poll'
      ? await service.poll(userId, connectionId)
      : await service.refresh(userId, connectionId)
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Subscription update failed'
    return responseError(message, /busy|not due/.test(message) ? 409 : 400)
  }
}

export async function disconnectSubscriptionConnection(userId: string, connectionId: string) {
  const connection = await fetchOwnedConnection(userId, connectionId)
  if (!connection || !isSubscriptionConnection(connection)) return responseError('Connection not found', 404)
  try {
    await createSubscriptionService().disconnect(userId, connectionId)
    await getOverlayServerContext().appData.repositories.providerConnections.remove({
      userId, connectionId,
    })
    return NextResponse.json({ data: { connectionId, disconnected: true } })
  } catch (_error) {
    return responseError('Subscription cleanup is pending. Retry disconnect.', 503)
  }
}
