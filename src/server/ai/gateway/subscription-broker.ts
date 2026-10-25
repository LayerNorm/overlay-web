import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from '@/server/ai/provider-types'
import type { SubscriptionProviderId } from '@/shared/ai/gateway/subscription-providers'

type BrokerConfig = { baseUrl: URL; key: string }

function readBrokerConfig(): BrokerConfig | null {
  const rawUrl = process.env.OVERLAY_SUBSCRIPTION_BROKER_URL?.trim()
  const key = process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY?.trim()
  if (!rawUrl || !key) return null
  const baseUrl = new URL(rawUrl)
  const localDevelopment = process.env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)
  if ((!localDevelopment && baseUrl.protocol !== 'https:') ||
      !['https:', 'http:'].includes(baseUrl.protocol) ||
      baseUrl.pathname !== '/' ||
      baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      key.length < 32) {
    throw new Error('Subscription broker configuration is invalid')
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '')
  return { baseUrl, key }
}

export function isSubscriptionBrokerConfigured(): boolean {
  try {
    return Boolean(readBrokerConfig())
  } catch (_error) {
    return false
  }
}

export async function subscriptionBrokerRequest<T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const config = readBrokerConfig()
  if (!config) throw new Error('Subscription connections are not available on this deployment')
  if (!path.startsWith('/v1/subscriptions/')) throw new Error('Invalid subscription broker operation')
  const response = await fetch(new URL(path, config.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Subscription broker response is too large')
  let result: unknown
  try {
    result = JSON.parse(text)
  } catch (_error) {
    throw new Error('Subscription broker returned an invalid response')
  }
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result &&
      typeof result.error === 'string'
      ? result.error
      : 'Subscription service request failed'
    throw new Error(error)
  }
  return result as T
}

export function createSubscriptionLanguageModel(
  args: {
    ownerId: string
    connectionId: string
    providerId: SubscriptionProviderId
    modelId: string
  },
): LanguageModel {
  const config = readBrokerConfig()
  if (!config) throw new Error('Subscription connections are not available on this deployment')
  const baseURL = new URL('/v1', config.baseUrl).toString().replace(/\/$/, '')
  const provider = createOpenAI({
    apiKey: config.key,
    baseURL,
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      const expected = new URL(baseURL)
      if (target.origin !== expected.origin ||
          !['/v1/chat/completions', '/v1/responses'].includes(target.pathname) ||
          init?.method?.toUpperCase() !== 'POST') {
        throw new Error('Unsupported subscription inference request')
      }
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${config.key}`)
      headers.set('x-overlay-owner-id', args.ownerId)
      headers.set('x-overlay-connection-id', args.connectionId)
      return fetch(target, { ...init, headers, redirect: 'error', cache: 'no-store' })
    },
  })
  return (args.providerId === 'codex'
    ? provider.responses(args.modelId)
    : provider.chat(args.modelId)) as LanguageModel
}

export type SubscriptionConnectionResult = {
  status: 'pending' | 'connected' | 'expired' | 'error'
  models?: Array<{ id: string; name: string }>
  error?: string
}
