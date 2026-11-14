import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { StepResult, ToolSet } from 'ai'

// Prompt caching for harness model calls. Providers reuse the longest unchanged
// prompt prefix (tools, then system, then messages), so the harness keeps that
// prefix byte-stable between steps: the system prompt holds only fixed
// instructions and the per-step working state rides in one trailing message.
// Measured in scripts/experiments/prompt-caching.mts.

const STATE_FLAG = 'harnessWorkingState'

type ProviderOptions = Record<string, Record<string, unknown>>
type PromptEntry = { role: string; content: unknown; providerOptions?: ProviderOptions }

/**
 * The trailing per-step working-state message. Replaced, never accumulated.
 * Text-part content keeps it valid as both a ModelMessage and a provider prompt message.
 */
export function harnessStateMessage(text: string): {
  role: 'user'; content: Array<{ type: 'text'; text: string }>; providerOptions: { overlay: { [STATE_FLAG]: true } }
} {
  return { role: 'user', content: [{ type: 'text', text }], providerOptions: { overlay: { [STATE_FLAG]: true } } }
}

export function isHarnessStateMessage(message: { role: string; providerOptions?: unknown }): boolean {
  const overlay = (message.providerOptions as ProviderOptions | undefined)?.overlay
  return message.role === 'user' && overlay?.[STATE_FLAG] === true
}

/** AI SDK carries prepareStep messages forward; drop earlier state messages before reuse or persistence. */
export function withoutHarnessStateMessages<T extends { role: string; providerOptions?: unknown }>(messages: T[]): T[] {
  return messages.some(isHarnessStateMessage) ? messages.filter(message => !isHarnessStateMessage(message)) : messages
}

// Anthropic caches nothing unless blocks carry cacheControl, so mark tools, system and conversation.
// Providers with implicit caching (OpenAI, Gemini, DeepSeek, Kimi) only need the stable prefix.
export function usesExplicitPromptCache(modelId: string): boolean {
  return /(^|\/)(anthropic\/|claude)/i.test(modelId.replace(/^byok\/[^/]+\//, ''))
}

const CACHE_POINT = { cacheControl: { type: 'ephemeral' } }

function withoutCachePoint(options: ProviderOptions | undefined): ProviderOptions | undefined {
  if (!options) return options
  const next = { ...options }
  for (const key of ['anthropic', 'openrouter'] as const) {
    if (!next[key] || !('cacheControl' in next[key])) continue
    const rest = { ...next[key] }
    delete rest.cacheControl
    if (Object.keys(rest).length) next[key] = rest
    else delete next[key]
  }
  return next
}

function withCachePoint(options: ProviderOptions | undefined): ProviderOptions {
  return { ...options, anthropic: { ...options?.anthropic, ...CACHE_POINT }, openrouter: { ...options?.openrouter, ...CACHE_POINT } }
}

function withoutOverlayFlag(options: ProviderOptions | undefined): ProviderOptions | undefined {
  if (!options?.overlay) return options
  const next = { ...options }
  delete next.overlay
  return Object.keys(next).length ? next : undefined
}

/**
 * Applied inside the model dispatch step (secure-model.ts). Uses at most three
 * of Anthropic's four breakpoints: last tool, system prompt, last conversation message.
 */
export function applyHarnessPromptCache(modelId: string, options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
  const prompt = (options.prompt as PromptEntry[]).map(entry => {
    const providerOptions = withoutOverlayFlag(withoutCachePoint(entry.providerOptions))
    const next = { ...entry }
    if (providerOptions) next.providerOptions = providerOptions
    else delete next.providerOptions
    return next
  })
  if (!usesExplicitPromptCache(modelId)) {
    return { ...options, prompt: prompt as LanguageModelV4CallOptions['prompt'] }
  }
  const lastSystem = prompt.findLastIndex(entry => entry.role === 'system')
  if (lastSystem >= 0) prompt[lastSystem] = { ...prompt[lastSystem]!, providerOptions: withCachePoint(prompt[lastSystem]!.providerOptions) }
  const stateIndex = (options.prompt as PromptEntry[]).findLastIndex(isHarnessStateMessage)
  const conversationEnd = (stateIndex >= 0 ? stateIndex : prompt.length) - 1
  if (conversationEnd > lastSystem) {
    prompt[conversationEnd] = { ...prompt[conversationEnd]!, providerOptions: withCachePoint(prompt[conversationEnd]!.providerOptions) }
  }
  const tools = options.tools?.map((tool, index, all) => {
    if (tool.type !== 'function') return tool
    const providerOptions = withoutCachePoint(tool.providerOptions as ProviderOptions | undefined)
    return index === all.length - 1
      ? { ...tool, providerOptions: withCachePoint(providerOptions) }
      : { ...tool, ...(providerOptions ? { providerOptions } : {}) }
  })
  return { ...options, prompt: prompt as LanguageModelV4CallOptions['prompt'],
    ...(tools ? { tools: tools as LanguageModelV4CallOptions['tools'] } : {}) }
}

/**
 * The Gateway may serve open-weight models from several upstreams, and caches
 * do not cross upstreams. Prefer the upstream that served most of this run's
 * steps (ties go to the earliest), so a one-off failover does not move the run
 * to a cold cache. `order` keeps failover, unlike `only`.
 */
export function stickyGatewayUpstream(modelId: string, steps: readonly StepResult<ToolSet>[]): string | undefined {
  if (modelId.startsWith('byok/')) return undefined
  const counts = new Map<string, number>()
  for (const step of steps) {
    if (step.model?.modelId !== undefined && step.model.modelId !== modelId) continue
    const routing = (step.providerMetadata?.gateway as { routing?: { finalProvider?: unknown } } | undefined)?.routing
    if (typeof routing?.finalProvider !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(routing.finalProvider)) continue
    counts.set(routing.finalProvider, (counts.get(routing.finalProvider) ?? 0) + 1)
  }
  let best: string | undefined
  for (const [upstream, count] of counts) if (best === undefined || count > counts.get(best)!) best = upstream
  return best
}
