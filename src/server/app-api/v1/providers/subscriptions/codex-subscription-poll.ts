import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  codexAccessTokenExpiry,
  CodexSignInError,
  pollCodexDeviceCode,
} from '@/server/agents/provider-accounts/codex-subscription'
import {
  subscriptionBrokerRequest,
  type SubscriptionConnectionResult,
} from '@/server/ai/gateway/subscription-broker'

type PollResult =
  | { response: NextResponse }
  | { result: SubscriptionConnectionResult }

export async function pollCodexSubscription(
  userId: string,
  connectionId: string,
): Promise<PollResult> {
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  const brokerBody = { ownerId: userId, connectionId, providerId: 'codex' as const }
  const device = await subscriptionBrokerRequest<{
    status: string
    deviceCode?: { deviceAuthId: string; userCode: string; expiresAt: number }
    authorizationGeneration?: string
    pollLease?: { token: string; expiresAt: number }
    models?: Array<{ id: string; name: string }>
  }>('/v1/subscriptions/codex-device', brokerBody)
  if (device.status === 'polling') {
    return { response: NextResponse.json({ data: { status: 'pending' } }) }
  }
  if (device.status === 'connected') {
    return { result: { status: 'connected', models: device.models } }
  }
  const deviceCode = device.deviceCode
  if (device.status === 'expired' || !deviceCode) {
    await repository.update({
      connectionId, userId, status: 'error',
      lastError: 'Codex authorization expired. Reconnect to continue.',
    })
    return {
      response: NextResponse.json({
        data: { status: device.status === 'expired' ? 'expired' : 'error' },
      }),
    }
  }
  return await pollCodexDevice({ ...device, deviceCode }, brokerBody, repository)
}

async function pollCodexDevice(
  device: {
    deviceCode: { deviceAuthId: string; userCode: string; expiresAt: number }
    authorizationGeneration?: string
    pollLease?: { token: string; expiresAt: number }
  },
  brokerBody: { ownerId: string; connectionId: string; providerId: 'codex' },
  repository: ReturnType<typeof getOverlayServerContext>['appData']['repositories']['providerConnections'],
): Promise<PollResult> {
  try {
    try {
      const tokens = await pollCodexDeviceCode({
        deviceAuthId: device.deviceCode.deviceAuthId,
        userCode: device.deviceCode.userCode,
      })
      const expiry = codexAccessTokenExpiry(tokens)
      if (!expiry || expiry <= Date.now()) {
        await repository.update({
          connectionId: brokerBody.connectionId,
          userId: brokerBody.ownerId,
          status: 'error',
          lastError: 'OpenAI returned an expired subscription token. Reconnect.',
        })
        return {
          response: NextResponse.json({
            data: { status: 'error', error: 'OpenAI returned an expired subscription token. Reconnect.' },
          }),
        }
      }
      const result = await subscriptionBrokerRequest<SubscriptionConnectionResult>(
        '/v1/subscriptions/import-codex',
        {
          ...brokerBody,
          authorizationGeneration: device.authorizationGeneration,
          pollLease: device.pollLease?.token,
          tokens: { ...tokens, expired: new Date(expiry).toISOString() },
        },
      )
      return { result }
    } catch (error) {
      if (error instanceof CodexSignInError && error.code === 'pending') {
        return { response: NextResponse.json({ data: { status: 'pending' } }) }
      }
      if (error instanceof CodexSignInError && error.code === 'expired') {
        await repository.update({
          connectionId: brokerBody.connectionId,
          userId: brokerBody.ownerId,
          status: 'error',
          lastError: 'Codex authorization expired. Reconnect to continue.',
        })
        return { response: NextResponse.json({ data: { status: 'expired' } }) }
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
}
