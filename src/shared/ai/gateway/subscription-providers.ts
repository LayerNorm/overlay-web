export const SUBSCRIPTION_PROVIDERS = [
  { id: 'codex', label: 'ChatGPT/Codex', description: 'Connect a ChatGPT account to use its discovered Codex models.', enabled: false },
  { id: 'claude', label: 'Claude', description: 'Connect a Claude account using a one-time authorization callback.', enabled: false },
  { id: 'xai', label: 'Grok Build', description: 'Connect an xAI account using device authorization.', enabled: false },
  { id: 'meta', label: 'Meta Muse', description: 'Connect a Meta account using device authorization.', enabled: false },
  { id: 'kimi', label: 'Kimi', description: 'Connect a Kimi account using device authorization.', enabled: false },
  { id: 'devin', label: 'Devin', description: 'Connect a Devin account using a one-time authorization callback.', enabled: false },
] as const

export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDERS)[number]['id']

export function isSubscriptionProviderId(value: unknown): value is SubscriptionProviderId {
  return typeof value === 'string' &&
    SUBSCRIPTION_PROVIDERS.some((provider) => provider.id === value)
}

export function subscriptionProvider(value: SubscriptionProviderId) {
  return SUBSCRIPTION_PROVIDERS.find((provider) => provider.id === value)!
}

export function isSubscriptionConnection(
  connection: { authKind?: unknown; providerId?: unknown; subscriptionProvider?: unknown } | null | undefined,
): boolean {
  return Boolean(
    connection?.authKind === 'subscription' &&
    isSubscriptionProviderId(connection.subscriptionProvider) &&
    connection.providerId === `subscription:${connection.subscriptionProvider}`,
  )
}
