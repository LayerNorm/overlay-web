export const USAGE_STATEMENT_CATEGORIES = [
  'models',
  'browser',
  'sandbox',
  'generation',
  'transcription',
  'tools',
] as const

export type UsageStatementCategory = (typeof USAGE_STATEMENT_CATEGORIES)[number]

export type UsageSpendKindLike =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export type UsageStatementLine = {
  id: string
  occurredAt: number
  label: string
  detail?: string
  costCents: number
  providerCostUsd?: number
  success?: boolean
}

export type UsageStatementCategorySummary = {
  category: UsageStatementCategory
  count: number
  hasMore: boolean
  lines: UsageStatementLine[]
  totalCents: number
}

export type UsageStatement = {
  billingAccountId: string
  categories: UsageStatementCategorySummary[]
  periodEnd?: number
  periodStart: number
  totalCents: number
}

export type UsageStatementLinesPage = {
  category: UsageStatementCategory
  hasMore: boolean
  lines: UsageStatementLine[]
  nextOffset: number
}

export const USAGE_STATEMENT_DEFAULT_LINES = 10
export const USAGE_STATEMENT_MAX_LINES = 50

export const USAGE_STATEMENT_CATEGORY_LABELS: Record<UsageStatementCategory, string> = {
  models: 'AI models',
  browser: 'Browser use',
  sandbox: 'Sandboxes',
  generation: 'Media generation',
  transcription: 'Transcription',
  tools: 'Tools',
}

export function usageStatementCategoryForKind(
  kind: UsageSpendKindLike,
  modelId?: string,
): UsageStatementCategory {
  switch (kind) {
    case 'transcription':
      return 'transcription'
    case 'sandbox':
      return 'sandbox'
    case 'generation':
      return modelId?.startsWith('browser-use/') ? 'browser' : 'generation'
    default:
      return 'models'
  }
}

export function normalizeUsageStatementLinesLimit(limit?: number): number {
  if (limit === undefined) return USAGE_STATEMENT_DEFAULT_LINES
  return Math.max(1, Math.min(Math.trunc(limit), USAGE_STATEMENT_MAX_LINES))
}

export function normalizeUsageStatementOffset(offset?: number): number {
  if (offset === undefined) return 0
  return Math.max(0, Math.trunc(offset))
}

export function buildUsageStatement(args: {
  billingAccountId: string
  linesByCategory: Map<UsageStatementCategory, UsageStatementLine[]>
  linesPerCategory?: number
  periodEnd?: number
  periodStart: number
}): UsageStatement {
  const linesPerCategory = normalizeUsageStatementLinesLimit(args.linesPerCategory)
  const categories: UsageStatementCategorySummary[] = []
  let totalCents = 0
  for (const category of USAGE_STATEMENT_CATEGORIES) {
    const lines = (args.linesByCategory.get(category) ?? [])
      .sort((a, b) => b.occurredAt - a.occurredAt)
    if (lines.length === 0) continue
    const categoryTotal = lines.reduce((total, line) => total + line.costCents, 0)
    totalCents += categoryTotal
    categories.push({
      category,
      count: lines.length,
      hasMore: lines.length > linesPerCategory,
      lines: lines.slice(0, linesPerCategory),
      totalCents: roundStatementCents(categoryTotal),
    })
  }
  return {
    billingAccountId: args.billingAccountId,
    categories,
    ...(args.periodEnd === undefined ? {} : { periodEnd: args.periodEnd }),
    periodStart: args.periodStart,
    totalCents: roundStatementCents(totalCents),
  }
}

export function roundStatementCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10_000) / 10_000
}
