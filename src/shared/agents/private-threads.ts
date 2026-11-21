/**
 * Private threads ("Cloud sync" off) run and are stored only on the computer the desktop app is open on
 * (internal/develop/private-threads.md). Their ids never collide with Convex ids, so the agent page can tell them apart.
 */
export const PRIVATE_THREAD_PREFIX = 'private_'

export function isPrivateThreadId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(PRIVATE_THREAD_PREFIX) && /^private_[a-z0-9]{8,64}$/.test(id)
}

export function newPrivateThreadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${PRIVATE_THREAD_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export const PRIVATE_MODEL_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter'] as const
export type PrivateModelProvider = (typeof PRIVATE_MODEL_PROVIDERS)[number]
export const PRIVATE_PROVIDER_NAMES: Record<PrivateModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  openrouter: 'OpenRouter',
}

/** `provider/model` as stored with a private thread. */
export function parsePrivateModel(value: string | null | undefined): { provider: PrivateModelProvider; modelId: string } | null {
  if (!value) return null
  const slash = value.indexOf('/')
  const provider = value.slice(0, slash) as PrivateModelProvider
  const modelId = value.slice(slash + 1)
  return slash > 0 && modelId && PRIVATE_MODEL_PROVIDERS.includes(provider) ? { provider, modelId } : null
}
