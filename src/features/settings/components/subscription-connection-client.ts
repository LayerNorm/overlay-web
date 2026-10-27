import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

export type SubscriptionProvider = { id: string; label: string; description: string; enabled: boolean }
export type SubscriptionAvailability = { available: boolean; providers: SubscriptionProvider[]; reason?: string }
export type SubscriptionAuthorization = {
  connectionId: string
  authorization: { url: string; userCode?: string; expiresAt: number; interval: number; callbackRequired?: boolean }
}
export type SubscriptionProgress = {
  status: 'pending' | 'connected' | 'expired' | 'error'
  error?: string
  connection?: ByokConnectionRow
}

export function subscriptionLogo(providerId: string): string {
  const id = providerId.replace(/^subscription:/, '')
  return ({ codex: 'openai', kimi: 'moonshotai', 'kimi-ai': 'moonshotai', meta: 'meta-llama' } as Record<string, string>)[id] ?? id
}

export async function subscriptionRequest<T>(body?: Record<string, unknown>, options: { method?: string; signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<T> {
  const response = await fetch('/api/v1/providers/subscriptions', {
    method: options.method ?? (body ? 'PATCH' : 'GET'),
    cache: 'no-store',
    signal: options.signal,
    ...(body ? {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() },
      body: JSON.stringify(body),
    } : {}),
  })
  const result = await response.json().catch(() => null) as { data?: T; error?: string | { message?: string } } | null
  if (!response.ok || !result?.data) {
    const error = typeof result?.error === 'string' ? result.error : result?.error?.message
    throw new Error(error ?? 'Could not reach subscription connections. Try again.')
  }
  return result.data
}
