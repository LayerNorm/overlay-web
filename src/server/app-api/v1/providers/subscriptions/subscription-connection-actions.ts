import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  enabledSubscriptionProviderIds,
  subscriptionBrokerRequest,
  type SubscriptionConnectionResult,
} from '@/server/ai/gateway/subscription-broker'
import { requestCodexDeviceCode } from '@/server/agents/provider-accounts/codex-subscription'
import {
  isSubscriptionConnection,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'
import { pollCodexSubscription } from './codex-subscription-poll'
import {
  MAX_CONNECTIONS,
  fetchOwnedConnection,
  providerConnectionName,
  updateConnectedMetadata,
} from './subscription-connection-helpers'

type OwnedConnection = NonNullable<Awaited<ReturnType<typeof fetchOwnedConnection>>>
type SubscriptionUpdateBody = Record<string, unknown> & {
  action: 'poll' | 'refresh' | 'callback'
}

export async function startSubscriptionConnection(
  userId: string,
  providerId: SubscriptionProviderId,
  requestedConnectionId?: string,
) {
  if (!enabledSubscriptionProviderIds().includes(providerId)) {
    return NextResponse.json(
      { error: 'This subscription provider is not enabled for this deployment' },
      { status: 404 },
    )
  }
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  let connectionId = requestedConnectionId
  let created = false
  if (connectionId) {
    const existing = await repository.get({ connectionId, userId })
    if (!existing || !isSubscriptionConnection(existing) ||
        existing.subscriptionProvider !== providerId) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
  } else {
    if (await repository.count({ userId }) >= MAX_CONNECTIONS) {
      return NextResponse.json({ error: 'Provider connection limit reached' }, { status: 409 })
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
  return await startAuthorization(repository, userId, connectionId, providerId, created)
}

async function startAuthorization(
  repository: ReturnType<typeof getOverlayServerContext>['appData']['repositories']['providerConnections'],
  userId: string,
  connectionId: string,
  providerId: SubscriptionProviderId,
  created: boolean,
) {
  try {
    let authorization: {
      url: string
      userCode?: string
      expiresAt: number
      interval: number
      callbackRequired?: boolean
    }
    if (providerId === 'codex') {
      const device = await requestCodexDeviceCode()
      const result = await subscriptionBrokerRequest<{ authorization: typeof authorization }>(
        '/v1/subscriptions/start-codex',
        {
          ownerId: userId,
          connectionId,
          providerId,
          deviceAuthId: device.deviceAuthId,
          userCode: device.userCode,
          expiresAt: device.expiresAt,
          interval: device.interval,
        },
      )
      authorization = result.authorization
    } else {
      const result = await subscriptionBrokerRequest<{ authorization: typeof authorization }>(
        '/v1/subscriptions/start',
        { ownerId: userId, connectionId, providerId },
      )
      authorization = result.authorization
    }
    await repository.update({ connectionId, userId, status: 'pending', lastError: '' })
    return NextResponse.json({ data: { connectionId, authorization } })
  } catch (_error) {
    if (created) {
      await cleanupCreatedConnection(repository, userId, connectionId, providerId)
    } else {
      await repository.update({
        connectionId,
        userId,
        status: 'error',
        lastError: 'Authorization could not be started. Retry or reconnect.',
      }).catch((_error) => undefined)
    }
    return NextResponse.json({
      error: 'Could not start subscription authorization. Retry or contact support.',
    }, { status: 503 })
  }
}

async function cleanupCreatedConnection(
  repository: ReturnType<typeof getOverlayServerContext>['appData']['repositories']['providerConnections'],
  userId: string,
  connectionId: string,
  providerId: SubscriptionProviderId,
) {
  try {
    await subscriptionBrokerRequest('/v1/subscriptions/disconnect', {
      ownerId: userId,
      connectionId,
      providerId,
    })
    await repository.remove({ connectionId, userId })
  } catch (_error) {
    await repository.update({
      connectionId,
      userId,
      status: 'error',
      lastError: 'Authorization cleanup is pending; retry disconnect before reconnecting.',
    }).catch((_error) => undefined)
  }
}

export async function executeSubscriptionUpdate(
  userId: string,
  connectionId: string,
  body: SubscriptionUpdateBody,
  connection: OwnedConnection,
) {
  const providerId = connection.subscriptionProvider as SubscriptionProviderId
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  const brokerBody = { ownerId: userId, connectionId, providerId }
  try {
    const output = await runSubscriptionAction(body, providerId, brokerBody)
    if (output.response) return output.response
    const result = output.result
    if (result.status === 'connected' && result.models) {
      const priorDiscovery = typeof connection.discoveredModelsJson === 'string' &&
        connection.discoveredModelsJson.trim() !== ''
      const previousEnabled = connection.status === 'active' || priorDiscovery ||
        Boolean(connection.discoveredAt) ? connection.enabledModelIds : undefined
      const updated = await updateConnectedMetadata(
        userId,
        connectionId,
        providerId,
        result.models,
        previousEnabled,
      )
      return NextResponse.json({ data: { status: 'connected', connection: updated } })
    }
    if (result.status === 'expired' || result.status === 'error') {
      await repository.update({
        connectionId,
        userId,
        status: result.status === 'expired' ? 'error' : 'error',
        lastError: result.error ?? 'Authorization expired. Reconnect to continue.',
      })
    }
    return NextResponse.json({
      data: {
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      },
    })
  } catch (_error) {
    await repository.update({
      connectionId, userId, status: 'error',
      lastError: 'The subscription operation failed. Retry or reconnect.',
    }).catch((_error: unknown) => undefined)
    return NextResponse.json({
      data: { status: 'error', error: 'The subscription operation failed. Retry or reconnect.' },
    })
  }
}

async function runSubscriptionAction(
  body: SubscriptionUpdateBody,
  providerId: SubscriptionProviderId,
  brokerBody: { ownerId: string; connectionId: string; providerId: SubscriptionProviderId },
) {
  if (body.action === 'callback') {
    return await runCallbackAction(body, providerId, brokerBody)
  }
  if (providerId === 'codex' && body.action === 'poll') {
    const poll = await pollCodexSubscription(brokerBody.ownerId, brokerBody.connectionId)
    return 'response' in poll ? { response: poll.response } : { result: poll.result }
  }
  const result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
    `/v1/subscriptions/${body.action}`,
    brokerBody,
  )
  return { result }
}

async function runCallbackAction(
  body: SubscriptionUpdateBody,
  providerId: SubscriptionProviderId,
  brokerBody: { ownerId: string; connectionId: string; providerId: SubscriptionProviderId },
) {
  if (providerId !== 'devin' || typeof body.callbackUrl !== 'string' ||
      body.callbackUrl.length > 4096) {
    return {
      response: NextResponse.json({ error: 'Invalid authorization callback' }, { status: 400 }),
    }
  }
  const result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
    '/v1/subscriptions/callback',
    { ...brokerBody, callbackUrl: body.callbackUrl },
  )
  return { result }
}

export type { OwnedConnection, SubscriptionUpdateBody }
