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

/** Plans a person signs in to on this computer; the desktop runs them through its local CLIProxyAPI. */
export const PRIVATE_PLAN_PROVIDERS = ['claude', 'chatgpt'] as const
export type PrivatePlanProvider = (typeof PRIVATE_PLAN_PROVIDERS)[number]
export const PRIVATE_PLAN_NAMES: Record<PrivatePlanProvider, string> = { claude: 'Claude', chatgpt: 'ChatGPT' }
/** Which catalog provider's models each plan runs. */
export const PRIVATE_PLAN_CATALOG_PROVIDER: Record<PrivatePlanProvider, 'anthropic' | 'openai'> = { claude: 'anthropic', chatgpt: 'openai' }

/** How a private turn calls its model: a key, a plan, or Overlay's metered models (`overlay`, paid workspaces). */
export type PrivateModelSource = PrivateModelProvider | PrivatePlanProvider | 'overlay'
const PRIVATE_MODEL_SOURCES: readonly string[] = [...PRIVATE_MODEL_PROVIDERS, ...PRIVATE_PLAN_PROVIDERS, 'overlay']

/** `source/model` as stored with a private thread. */
export function parsePrivateModel(value: string | null | undefined): { provider: PrivateModelSource; modelId: string } | null {
  if (!value) return null
  const slash = value.indexOf('/')
  const provider = value.slice(0, slash) as PrivateModelSource
  const modelId = value.slice(slash + 1)
  return slash > 0 && modelId && PRIVATE_MODEL_SOURCES.includes(provider) ? { provider, modelId } : null
}
