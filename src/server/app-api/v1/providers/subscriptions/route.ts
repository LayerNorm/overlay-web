import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  enabledSubscriptionProviderIds,
  isSubscriptionBrokerConfigured,
  subscriptionBrokerReadiness,
} from '@/server/ai/gateway/subscription-broker'
import {
  isSubscriptionConnection,
  isSubscriptionProviderId,
  SUBSCRIPTION_PROVIDERS,
  subscriptionProvider,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import {
  executeSubscriptionUpdate,
  startSubscriptionConnection,
  type SubscriptionUpdateBody,
} from './subscription-connection-actions'
import {
  CONNECTION_ID,
  fetchOwnedConnection,
  isRecord,
  responseError,
  withConnectionLock,
} from './subscription-connection-helpers'

export async function GET(_request: NextRequest, _context: AppApiRouteContext) {
  const configured = new Set(enabledSubscriptionProviderIds())
  const readiness = isSubscriptionBrokerConfigured()
    ? await subscriptionBrokerReadiness()
    : { ready: false, providers: [] as SubscriptionProviderId[] }
  const eligible = new Set(readiness.providers.filter((provider) => configured.has(provider)))
  const available = readiness.ready && eligible.size > 0
  return NextResponse.json({
    data: {
      available,
      providers: SUBSCRIPTION_PROVIDERS.map(({ id, label, description }) => ({
        id,
        label,
        description,
        enabled: eligible.has(id),
      })),
      ...(!available ? {
        reason: readiness.ready
          ? 'No subscription provider has been verified and enabled for this deployment.'
          : 'The subscription broker is not ready on this deployment.',
      } : {}),
    },
  })
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  if (!context.requestIdempotencyKey) {
    return responseError('Idempotency-Key header is required for subscription authorization', 428)
  }
  const body = await request.json().catch((_error) => null)
  if (!isRecord(body) || !isSubscriptionProviderId(body.providerId)) {
    return responseError('Unsupported subscription provider', 400)
  }
  if (body.connectionId !== undefined &&
      (typeof body.connectionId !== 'string' || !CONNECTION_ID.test(body.connectionId))) {
    return responseError('Invalid connectionId', 400)
  }
  return await startSubscriptionConnection(
    context.auth.userId,
    body.providerId,
    body.connectionId as string | undefined,
  )
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  if (!context.requestIdempotencyKey) {
    return responseError('Idempotency-Key header is required for subscription updates', 428)
  }
  const body = await request.json().catch((_error) => null)
  if (!isRecord(body) || typeof body.connectionId !== 'string' ||
      !CONNECTION_ID.test(body.connectionId) ||
      !['poll', 'refresh', 'callback'].includes(String(body.action))) {
    return responseError('Invalid subscription update', 400)
  }

  const { connectionId } = body as {
    connectionId: string
    action: 'poll' | 'refresh' | 'callback'
  }
  const userId = context.auth.userId
  return await withConnectionLock(userId, connectionId, async () => {
    const connection = await fetchOwnedConnection(userId, connectionId)
    if (!connection || !isSubscriptionConnection(connection)) {
      return responseError('Connection not found', 404)
    }
    const providerId = connection.subscriptionProvider as SubscriptionProviderId
    if (!enabledSubscriptionProviderIds().includes(providerId)) {
      return responseError('This subscription provider is not enabled for this deployment', 404)
    }
    return await executeSubscriptionUpdate(
      userId,
      connectionId,
      body as SubscriptionUpdateBody,
      connection,
    )
  })
}

export const subscriptionProviderName = (providerId: SubscriptionProviderId) =>
  subscriptionProvider(providerId).label
