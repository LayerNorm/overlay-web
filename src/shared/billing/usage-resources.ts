/**
 * Itemized usage: every settled charge (a finalized budget reservation) belongs to one resource. Resources are what a
 * workspace sees on its bill, so they follow what people pay for, not internal operation names.
 */
export type UsageResourceKey =
  | 'models'
  | 'automations'
  | 'computers'
  | 'web_search'
  | 'browser_tasks'
  | 'images'
  | 'video'
  | 'transcription'
  | 'memory'
  | 'knowledge'

export const USAGE_RESOURCE_LABELS: Record<UsageResourceKey, string> = {
  models: 'Models',
  automations: 'Automations',
  computers: 'Overlay Cloud computers',
  web_search: 'Web search',
  browser_tasks: 'Browser tasks',
  images: 'Image generation',
  video: 'Video generation',
  transcription: 'Transcription',
  memory: 'Memory',
  knowledge: 'Knowledge and search indexing',
}

export type UsageCharge = {
  kind: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription' | 'generation' | 'sandbox'
  operationId?: string
  modelId?: string
}

export function usageResourceFor(charge: UsageCharge): UsageResourceKey {
  const op = charge.operationId ?? ''
  if (charge.kind === 'sandbox') return 'computers'
  if (charge.kind === 'transcription' || op.startsWith('audio.')) return 'transcription'
  if (op.startsWith('websearch.')) return 'web_search'
  // Automation runs are metered per workflow step under the pseudo-model `workflow-steps`; model calls an automation
  // makes stay under Models, with their model.
  if (charge.modelId === 'workflow-steps') return 'automations'
  if (op.startsWith('agent.browser-task')) return 'browser_tasks'
  if (op.startsWith('media.generate-image')) return 'images'
  if (op.startsWith('media.generate-video')) return 'video'
  if (op.startsWith('memory.') || op === 'knowledge.compile-memory-profile') return 'memory'
  if (charge.kind === 'embedding' || op.startsWith('knowledge.')) return 'knowledge'
  return 'models'
}

/** One resource's total for a period; `models` also carries a total per model. */
export type UsageTotal = {
  resource: UsageResourceKey
  cents: number
  count: number
  tokens: number
  seconds: number
  byModel?: Array<{ modelId: string; cents: number; count: number; tokens: number }>
}

export type UsageRow = UsageCharge & { cents: number; tokens?: number; seconds?: number }

/** Adds up settled charges by resource, largest first. Models are also split per model. */
export function totalUsage(rows: readonly UsageRow[]): UsageTotal[] {
  const totals = new Map<UsageResourceKey, UsageTotal>()
  const models = new Map<string, { modelId: string; cents: number; count: number; tokens: number }>()
  for (const row of rows) {
    const resource = usageResourceFor(row)
    const total = totals.get(resource) ?? { resource, cents: 0, count: 0, tokens: 0, seconds: 0 }
    total.cents += Math.max(0, row.cents)
    total.count += 1
    total.tokens += Math.max(0, row.tokens ?? 0)
    total.seconds += Math.max(0, row.seconds ?? 0)
    totals.set(resource, total)
    if (resource === 'models') {
      const modelId = row.modelId || 'unknown'
      const model = models.get(modelId) ?? { modelId, cents: 0, count: 0, tokens: 0 }
      model.cents += Math.max(0, row.cents)
      model.count += 1
      model.tokens += Math.max(0, row.tokens ?? 0)
      models.set(modelId, model)
    }
  }
  const modelTotal = totals.get('models')
  if (modelTotal) modelTotal.byModel = [...models.values()].sort((a, b) => b.cents - a.cents)
  return [...totals.values()].sort((a, b) => b.cents - a.cents)
}

const COUNT_UNITS: Record<UsageResourceKey, [singular: string, plural: string]> = {
  models: ['request', 'requests'],
  automations: ['step', 'steps'],
  computers: ['session', 'sessions'],
  web_search: ['search', 'searches'],
  browser_tasks: ['task', 'tasks'],
  images: ['image', 'images'],
  video: ['video', 'videos'],
  transcription: ['recording', 'recordings'],
  memory: ['update', 'updates'],
  knowledge: ['item', 'items'],
}

/** "1h 12m" of machine time, "4.2M tokens" for models, otherwise a count ("214 searches"). */
export function formatUsageQuantity(total: Pick<UsageTotal, 'resource' | 'count' | 'tokens' | 'seconds'>): string {
  if ((total.resource === 'computers' || total.resource === 'transcription') && total.seconds > 0) {
    const minutes = Math.max(1, Math.round(total.seconds / 60))
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
  }
  if (total.resource === 'models' && total.tokens > 0) return `${formatTokens(total.tokens)} tokens`
  const [one, many] = COUNT_UNITS[total.resource]
  return `${total.count.toLocaleString('en-US')} ${total.count === 1 ? one : many}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(Math.round(tokens))
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** A readable name for a model id the catalog does not know: `openai/gpt-5.6-luna` → "GPT 5.6 Luna". */
export function humanizeModelId(modelId: string): string {
  const base = modelId.split('/').pop() ?? modelId
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (/^(gpt|ai|llm|o\d)$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}
