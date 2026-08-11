import 'server-only'

export const BILLABLE_FEATURE_CATEGORIES = [
  'shared_conversations_and_agents',
  'files_search_and_embeddings',
  'functions_integrations_and_mcp',
  'browser_and_sandbox',
  'media_and_transcription',
  'automations_scheduled_and_api',
] as const

export type BillableFeatureCategory = typeof BILLABLE_FEATURE_CATEGORIES[number]

type MeteredCoverage = {
  category: BillableFeatureCategory
  enforcement: readonly string[]
  id: string
  mode: 'metered'
}

type BoundedQuotaCoverage = {
  category: BillableFeatureCategory
  enforcement: readonly string[]
  id: string
  limit: number
  mode: 'bounded_quota'
  window: string
}

export type BillableFeatureCoverage = MeteredCoverage | BoundedQuotaCoverage

/**
 * Launch inventory for workspace-funded features. A feature may ship only when
 * it has an authoritative reservation boundary or an explicit server-enforced
 * quota. Tests keep this inventory and the enabled provider boundaries aligned.
 */
export const BILLABLE_FEATURE_COVERAGE: readonly BillableFeatureCoverage[] = [
  {
    category: 'shared_conversations_and_agents',
    enforcement: [
      'src/server/app-api/v1/conversations/act/route.ts',
      'src/server/agents/workspace-agent-invocation.ts',
      'src/server/billing/billing-runtime.ts',
    ],
    id: 'shared-chat-and-named-agents',
    mode: 'metered',
  },
  {
    category: 'files_search_and_embeddings',
    enforcement: [
      'src/server/knowledge/PostgresKnowledgeSearchRepository.ts',
      'src/server/knowledge/KnowledgeIndexService.ts',
      'convex/knowledge/knowledge.ts',
    ],
    id: 'knowledge-search-index-and-memory-extraction',
    mode: 'metered',
  },
  {
    category: 'files_search_and_embeddings',
    enforcement: [
      'src/server/security/rate-limit-specs.ts#files/files:ingest-document:user',
      'src/shared/billing/billing-pricing.ts#PAID_STORAGE_BASE_BYTES',
    ],
    id: 'file-ingestion-and-storage',
    limit: 20,
    mode: 'bounded_quota',
    window: '1_hour_and_plan_storage_cap',
  },
  {
    category: 'functions_integrations_and_mcp',
    enforcement: [
      'packages/overlay-tools-core/src/policy.ts#MAX_TOOL_STEPS_ACT',
      'src/server/app-api/v1/conversations/act/route.ts#isStepCount',
      'src/server/tools/mcp-tools.ts#MAX_MCP_TOOL_RESULT_CHARS',
    ],
    id: 'tool-calls-per-agent-turn',
    limit: 12,
    mode: 'bounded_quota',
    window: 'per_agent_turn',
  },
  {
    category: 'browser_and_sandbox',
    enforcement: [
      'src/server/app-api/v1/browser-task/route.ts',
      'src/server/app-api/v1/daytona/run/lifecycle.ts',
      'src/server/billing/billing-runtime.ts',
    ],
    id: 'browser-and-daytona-provider-spend',
    mode: 'metered',
  },
  {
    category: 'media_and_transcription',
    enforcement: [
      'src/server/app-api/v1/generate-image/route.ts',
      'src/server/app-api/v1/generate-video/route.ts',
      'src/server/app-api/v1/transcribe/route.ts',
    ],
    id: 'hosted-media-and-audio',
    mode: 'metered',
  },
  {
    category: 'automations_scheduled_and_api',
    enforcement: [
      'src/server/agent/run-act-turn.ts#automationId',
      'src/server/billing/automation-workflow-billing.ts#AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD',
      'src/server/app-api/bff-context.ts#getBillingProgrammaticSubjectId',
      'src/server/app-api/v1/conversations/act/route.ts',
    ],
    id: 'automation-and-api-provider-spend',
    mode: 'metered',
  },
] as const

export function assertBillableFeatureCoverage(
  coverage: readonly BillableFeatureCoverage[] = BILLABLE_FEATURE_COVERAGE,
): void {
  const covered = new Set(coverage.map((entry) => entry.category))
  for (const category of BILLABLE_FEATURE_CATEGORIES) {
    if (!covered.has(category)) throw new Error(`billable_feature_category_uncovered:${category}`)
  }
  for (const entry of coverage) {
    if (entry.enforcement.length === 0) throw new Error(`billable_feature_enforcement_missing:${entry.id}`)
    if (entry.mode === 'bounded_quota' && (!Number.isFinite(entry.limit) || entry.limit <= 0 || !entry.window)) {
      throw new Error(`billable_feature_quota_invalid:${entry.id}`)
    }
  }
}
