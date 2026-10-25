import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  enabledSubscriptionProviderIds,
  isSubscriptionBrokerConfigured,
  subscriptionBrokerReadiness,
  subscriptionBrokerRequest,
  type SubscriptionConnectionResult,
} from '@/server/ai/gateway/subscription-broker'
import {
  codexAccessTokenExpiry,
  CodexSignInError,
  pollCodexDeviceCode,
  requestCodexDeviceCode,
} from '@/server/agents/provider-accounts/codex-subscription'
import {
  isSubscriptionConnection,
  isSubscriptionProviderId,
  SUBSCRIPTION_PROVIDERS,
  subscriptionProvider,
  type SubscriptionProviderId,
} from '@/shared/ai/gateway/subscription-providers'

const MAX_CONNECTIONS = 20
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/
const modelOperations = new Map<string, Promise<void>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function lockKey(userId: string, connectionId: string) {
  return `${userId}\0${connectionId}`
}

async function withConnectionLock<T>(
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

function providerConnectionName(providerId: SubscriptionProviderId) {
  return `${subscriptionProvider(providerId).label} subscription`
}

async function fetchOwnedConnection(userId: string, connectionId: string) {
  return await getOverlayServerContext().appData.repositories.providerConnections.get({
    connectionId,
    userId,
  })
}

async function updateConnectedMetadata(
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

  const userId = context.auth.userId
  const providerId = body.providerId
  if (!enabledSubscriptionProviderIds().includes(providerId)) {
    return responseError('This subscription provider is not enabled for this deployment', 404)
  }
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  let connectionId = body.connectionId as string | undefined
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
    } else {
      await repository.update({
        connectionId,
        userId,
        status: 'error',
        lastError: 'Authorization could not be started. Retry or reconnect.',
      }).catch((_error) => undefined)
    }
    return responseError('Could not start subscription authorization. Retry or contact support.', 503)
  }
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

  const { connectionId, action } = body as { connectionId: string; action: 'poll' | 'refresh' | 'callback' }
  const userId = context.auth.userId
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  return await withConnectionLock(userId, connectionId, async () => {
    const connection = await fetchOwnedConnection(userId, connectionId)
    if (!connection || !isSubscriptionConnection(connection)) {
      return responseError('Connection not found', 404)
    }
    const providerId = connection.subscriptionProvider as SubscriptionProviderId
    if (!enabledSubscriptionProviderIds().includes(providerId)) {
      return responseError('This subscription provider is not enabled for this deployment', 404)
    }
    const brokerBody = { ownerId: userId, connectionId, providerId }
    try {
      let result: SubscriptionConnectionResult
      if (action === 'callback') {
        if (providerId !== 'devin' || typeof body.callbackUrl !== 'string' || body.callbackUrl.length > 4096) {
          return responseError('Invalid authorization callback', 400)
        }
        result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
          '/v1/subscriptions/callback',
          { ...brokerBody, callbackUrl: body.callbackUrl },
        )
      } else if (providerId === 'codex' && action === 'poll') {
        const device = await subscriptionBrokerRequest<{
          status: string
          deviceCode?: { deviceAuthId: string; userCode: string; expiresAt: number }
          authorizationGeneration?: string
          pollLease?: { token: string; expiresAt: number }
          models?: Array<{ id: string; name: string }>
        }>('/v1/subscriptions/codex-device', brokerBody)
        if (device.status === 'polling') {
          return NextResponse.json({ data: { status: 'pending' } })
        }
        if (device.status === 'connected') {
          result = { status: 'connected', models: device.models }
        } else if (device.status === 'expired' || !device.deviceCode) {
          await repository.update({
            connectionId, userId, status: 'error',
            lastError: 'Codex authorization expired. Reconnect to continue.',
          })
          return NextResponse.json({
            data: { status: device.status === 'expired' ? 'expired' : 'error' },
          })
        } else try {
          try {
            const tokens = await pollCodexDeviceCode({
              deviceAuthId: device.deviceCode.deviceAuthId,
              userCode: device.deviceCode.userCode,
            })
            const expiry = codexAccessTokenExpiry(tokens)
            if (!expiry || expiry <= Date.now()) {
              await repository.update({
                connectionId, userId, status: 'error',
                lastError: 'OpenAI returned an expired subscription token. Reconnect.',
              })
              return NextResponse.json({
                data: { status: 'error', error: 'OpenAI returned an expired subscription token. Reconnect.' },
              })
            }
            result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
              '/v1/subscriptions/import-codex',
              {
                ...brokerBody,
                authorizationGeneration: device.authorizationGeneration,
                pollLease: device.pollLease?.token,
                tokens: { ...tokens, expired: new Date(expiry).toISOString() },
              },
            )
          } catch (error) {
            if (error instanceof CodexSignInError && error.code === 'pending') {
              return NextResponse.json({ data: { status: 'pending' } })
            }
            if (error instanceof CodexSignInError && error.code === 'expired') {
              await repository.update({
                connectionId, userId, status: 'error',
                lastError: 'Codex authorization expired. Reconnect to continue.',
              })
              return NextResponse.json({ data: { status: 'expired' } })
            }
            throw error
          }
        } finally {
          await subscriptionBrokerRequest('/v1/subscriptions/codex-release', {
            ...brokerBody,
            authorizationGeneration: device.authorizationGeneration,
            pollLease: device.pollLease?.token,
          }).catch((_error) => undefined)
        }
      } else {
        result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
          `/v1/subscriptions/${action}`,
          brokerBody,
        )
      }

      if (result.status === 'connected' && result.models) {
        const priorDiscovery = typeof connection.discoveredModelsJson === 'string' &&
          connection.discoveredModelsJson.trim() !== ''
        const previousEnabled = connection.status === 'active' || priorDiscovery || Boolean(connection.discoveredAt)
          ? connection.enabledModelIds
          : undefined
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
        await getOverlayServerContext().appData.repositories.providerConnections.update({
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
  })
}

export const subscriptionProviderName = (providerId: SubscriptionProviderId) =>
  subscriptionProvider(providerId).label
