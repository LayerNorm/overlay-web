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

/**
 * API-key connections that users buy as a subscription. Overlay shows them like
 * subscriptions (picker section, logo with plug badge, no "API key" tag), but
 * inference still uses the ordinary API-key path, never the subscription bridge.
 */
const API_KEY_SUBSCRIPTION_PRESETS = new Set(['opencode-go'])

/** Provider logos for API-key presets whose display name is not a logo key. */
const BYOK_PRESET_LOGOS: Record<string, string> = {
  'opencode-go': 'opencode',
  'opencode-zen': 'opencode',
}

export function isApiKeySubscriptionConnection(
  connection: { providerId?: unknown } | null | undefined,
): boolean {
  return typeof connection?.providerId === 'string' && API_KEY_SUBSCRIPTION_PRESETS.has(connection.providerId)
}

export function byokPresetLogo(providerId: string): string | undefined {
  return BYOK_PRESET_LOGOS[providerId]
}
