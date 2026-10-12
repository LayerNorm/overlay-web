import type { AgentProviderId } from './provider-accounts'

/**
 * A connected agent's model lives in its `modelId` after the `byo/<adapter>` sentinel: `byo/codex#gpt-6-astra[high]`.
 * No suffix means the agent's own default. The suffix is the agent's own model id, passed to it unchanged.
 */
const BYO_PREFIX = 'byo/'
const MODEL_SEPARATOR = '#'

export function byoModelId(adapterId: string, model?: string | null): string {
  const chosen = model?.trim()
  return chosen ? `${BYO_PREFIX}${adapterId}${MODEL_SEPARATOR}${chosen}` : `${BYO_PREFIX}${adapterId}`
}

export function parseByoModelId(modelId: string): { adapterId: string; model: string | null } | null {
  if (!modelId.startsWith(BYO_PREFIX)) return null
  const rest = modelId.slice(BYO_PREFIX.length)
  const at = rest.indexOf(MODEL_SEPARATOR)
  if (at < 0) return { adapterId: rest, model: null }
  return { adapterId: rest.slice(0, at), model: rest.slice(at + 1) || null }
}

export type AgentModelChoice = { value: string; label: string; hint?: string }

/**
 * The models each agent offers on a subscription, read from the agents themselves (Claude Code's `session/new`
 * model list; Codex's bundled catalog, as `slug[effort]` ids). Agents without a list use their own default.
 */
export const AGENT_MODEL_CHOICES: Partial<Record<AgentProviderId, readonly AgentModelChoice[]>> = {
  'claude-code': [
    { value: 'default', label: 'Default', hint: 'Claude Code picks (recommended)' },
    { value: 'opus[1m]', label: 'Opus 5.5', hint: 'Everyday, complex tasks' },
    { value: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'Hardest, longest-running tasks' },
    { value: 'sonnet', label: 'Sonnet 5', hint: 'Efficient for routine tasks' },
    { value: 'haiku', label: 'Haiku 4.5', hint: 'Fastest for quick answers' },
  ],
}

export type CodexModelChoice = { slug: string; label: string; efforts: readonly string[]; defaultEffort: string }

export const CODEX_MODEL_CHOICES: readonly CodexModelChoice[] = [
  { slug: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low' },
  { slug: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low' },
  { slug: 'gpt-6-sol', label: 'GPT-6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
  { slug: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
  { slug: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low' },
  { slug: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
  { slug: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
  { slug: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
]

/** Splits a Codex model id (`gpt-6-sol[high]`) into its model and reasoning effort. */
export function parseCodexModel(model: string | null): { slug: string; effort: string } | null {
  if (!model) return null
  const match = /^([^[\]]+)(?:\[([^\]]+)\])?$/.exec(model)
  if (!match) return null
  const choice = CODEX_MODEL_CHOICES.find((entry) => entry.slug === match[1])
  return { slug: match[1]!, effort: match[2] ?? choice?.defaultEffort ?? 'medium' }
}

export function codexModelId(slug: string, effort: string): string {
  return `${slug}[${effort}]`
}

/** True for agents that offer a model choice on a subscription. */
export function agentOffersModelChoice(adapterId: string): adapterId is 'claude-code' | 'codex' {
  return adapterId === 'claude-code' || adapterId === 'codex'
}
