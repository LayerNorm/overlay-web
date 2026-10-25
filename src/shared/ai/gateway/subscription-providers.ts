export const SUBSCRIPTION_PROVIDERS = [
  { id: 'codex', label: 'OpenAI', description: 'Use your ChatGPT subscription with Codex.', enabled: true },
  { id: 'xai', label: 'xAI', description: 'Use your xAI subscription.', enabled: true },
  { id: 'meta', label: 'Meta', description: 'Use your Meta subscription.', enabled: true },
  { id: 'kimi', label: 'Kimi', description: 'Use your Kimi subscription.', enabled: true },
  { id: 'kimi-ai', label: 'Kimi AI', description: 'Use your Kimi AI subscription.', enabled: true },
  { id: 'devin', label: 'Devin', description: 'Use your Devin subscription.', enabled: true },
] as const

export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDERS)[number]['id']

export function isSubscriptionProviderId(value: unknown): value is SubscriptionProviderId {
  return typeof value === 'string' &&
    SUBSCRIPTION_PROVIDERS.some((provider) => provider.id === value && provider.enabled)
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
