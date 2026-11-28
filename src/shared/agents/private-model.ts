import {
  PRIVATE_PLAN_CATALOG_PROVIDER,
  PRIVATE_PLAN_PROVIDERS,
  type PrivateModelProvider,
  type PrivateModelSource,
  type PrivatePlanProvider,
} from './private-threads'

/**
 * A private thread runs the agent's own model (internal/develop/private-threads.md), from the first source that has
 * it: a plan the person signed in to on this computer (Claude runs Anthropic models, ChatGPT OpenAI's), the provider's
 * key, an OpenRouter key, and finally Overlay's metered models when the workspace pays for them. Ids differ between
 * Overlay's catalog and providers ("anthropic/claude-sonnet-4.5" is "claude-sonnet-4-5-20250929" at Anthropic), so
 * matching ignores the catalog prefix, treats "." and "-" alike and accepts dated releases.
 */
export type ProviderModelList = { provider: PrivateModelProvider | PrivatePlanProvider; models: { id: string; name: string }[] }
export type ResolvedPrivateModel = { provider: PrivateModelSource; modelId: string }

const DIRECT: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google'])
const normalize = (id: string) => id.toLowerCase().replace(/\./g, '-')

function pick(models: { id: string }[], wanted: string): string | null {
  const target = normalize(wanted)
  const exact = models.find((model) => normalize(model.id) === target)
  if (exact) return exact.id
  // Dated releases ("claude-sonnet-4-5-20250929", "gpt-5-2025-08-07"); the newest sorts last by id.
  const dated = models
    .filter((model) => new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-?\\d{2}-?\\d{2}$`).test(normalize(model.id)))
    .map((model) => model.id)
    .sort()
  return dated.at(-1) ?? null
}

export function resolvePrivateModel(
  agentModelId: string,
  catalogProvider: string | undefined,
  lists: readonly ProviderModelList[],
  /** The agent's model is in Overlay's catalog and the workspace pays for Overlay's models. */
  overlay: { available: boolean } = { available: false },
): ResolvedPrivateModel | null {
  const slash = agentModelId.indexOf('/')
  const prefix = slash > 0 ? agentModelId.slice(0, slash) : undefined
  const name = slash > 0 ? agentModelId.slice(slash + 1) : agentModelId
  const provider = catalogProvider ?? prefix
  // A plan the person already pays for comes first.
  for (const plan of PRIVATE_PLAN_PROVIDERS) {
    if (PRIVATE_PLAN_CATALOG_PROVIDER[plan] !== provider) continue
    const list = lists.find((entry) => entry.provider === plan)
    const id = list ? pick(list.models, name) : null
    if (id) return { provider: plan, modelId: id }
  }
  if (provider && DIRECT.has(provider)) {
    const list = lists.find((entry) => entry.provider === provider)
    const id = list ? pick(list.models, name) : null
    if (id) return { provider: provider as PrivateModelProvider, modelId: id }
  }
  const openrouter = lists.find((entry) => entry.provider === 'openrouter')
  if (openrouter && provider) {
    const id = pick(openrouter.models, `${provider}/${name}`)
    if (id) return { provider: 'openrouter', modelId: id }
  }
  return overlay.available ? { provider: 'overlay', modelId: agentModelId } : null
}
