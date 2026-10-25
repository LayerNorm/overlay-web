export const SUBSCRIPTION_PROVIDERS = [
  { id: 'codex', label: 'ChatGPT/Codex', description: 'Use ChatGPT/Codex when this deployment has verified it.', enabled: false },
  { id: 'xai', label: 'Grok Build', description: 'Use Grok Build when this deployment has verified it.', enabled: false },
  { id: 'meta', label: 'Meta Muse', description: 'Use Meta Muse when this deployment has verified it.', enabled: false },
  { id: 'kimi', label: 'Kimi', description: 'Use Kimi when this deployment has verified it.', enabled: false },
  { id: 'kimi-ai', label: 'Kimi AI', description: 'Use Kimi AI when this deployment has verified it.', enabled: false },
  { id: 'devin', label: 'Devin', description: 'Use Devin when this deployment has verified it.', enabled: false },
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
