import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Benchmark harness config. Loads .env.local from the repo root so the same
 * AI_GATEWAY_API_KEY / INTERNAL_API_SECRET / Convex URL the app uses locally
 * drive the benchmark. Everything here is free-model only by default.
 */

// tsx runs .ts in CJS mode here (package.json has no "type":"module"), so
// import.meta is unavailable — use __dirname.
const REPO_ROOT = path.resolve(__dirname, '../../..')

for (const file of ['.env.local', '.env.development.local', '.env']) {
  const p = path.join(REPO_ROOT, file)
  if (!existsSync(p)) continue
  try {
    process.loadEnvFile(p)
  } catch {
    // Older Node without loadEnvFile — env must be supplied by the caller.
  }
}

/** All benchmark LLM traffic goes through this free gateway model unless overridden. */
// The `-free` alias was retired on the gateway; the paid id +
// providerOptions.gateway.has:['free'] routes to free-tier providers only.
export const FREE_MODEL_ID = 'inclusionai/ling-3.0-flash-vl'

export const config = {
  convexUrl: process.env.BENCH_CONVEX_URL ?? process.env.DEV_NEXT_PUBLIC_CONVEX_URL ?? '',
  prodConvexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
  serverSecret: process.env.INTERNAL_API_SECRET ?? '',
  gatewayUrl: (process.env.AI_GATEWAY_URL?.trim() || 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, ''),
  gatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? '',
  extractorModel: process.env.BENCH_EXTRACTOR_MODEL ?? FREE_MODEL_ID,
  answerModel: process.env.BENCH_ANSWER_MODEL ?? FREE_MODEL_ID,
  judgeModel: process.env.BENCH_JUDGE_MODEL ?? FREE_MODEL_ID,
  /**
   * synthetic bench userIds have no billing row — if budget reservations reject
   * them, point this at a real dev-account userId for billing while memories
   * stay under the bench userId.
   */
  billingUserId: process.env.BENCH_BILLING_USER_ID ?? '',
  /** Retrieval params mirror production auto-retrieval defaults. Env overrides enable post-M2b ablations (raise m, drop recency decay, vector floor) without code edits. */
  retrieval: {
    kVec: Number(process.env.BENCH_RETRIEVAL_KVEC ?? 40),
    kLex: Number(process.env.BENCH_RETRIEVAL_KLEX ?? 40),
    m: Number(process.env.BENCH_RETRIEVAL_M ?? 10),
    sourceKind: 'memory' as const,
    /** Set BENCH_RECENCY_DECAY=0 to ablate the M2 memory-chunk half-life. */
    applyRecencyDecay: process.env.BENCH_RECENCY_DECAY !== '0',
    /** Optional vector-similarity floor passed through to hybridSearch. */
    minVecScore: process.env.BENCH_MIN_VEC_SCORE ? Number(process.env.BENCH_MIN_VEC_SCORE) : undefined,
    /** Set BENCH_TEMPORAL=0 to ablate the temporal-window dual-search list. */
    temporalQuery: process.env.BENCH_TEMPORAL !== '0',
    /** Set BENCH_PROVENANCE=0 to ablate source-turn chunk attachment. */
    includeProvenance: process.env.BENCH_PROVENANCE !== '0',
  },
  /**
   * Passive-mode query expansion: one call rewrites the question into ≤3
   * alternate phrasings and unions their hits — captures much of the agentic
   * loop's gain at ~1/3 its latency. Opt-in: BENCH_QUERY_EXPANSION=1.
   */
  queryExpansion: process.env.BENCH_QUERY_EXPANSION === '1',
  /**
   * M2 verbatim-message index. Off for runs against a pre-M2 deployment —
   * indexMessageContent doesn't exist there and `sourceKinds` fails arg
   * validation — and for A/B isolating the message layer's contribution.
   */
  includeMessages: process.env.BENCH_MESSAGE_INDEX !== '0',
  /**
   * Answer protocol. 'passive' = single-pass prefetch → answer (the protocol
   * every run through post-m2 measured). 'agentic' = same prefetch, then a
   * bounded reformulate→search loop (≤ maxSearchRounds) → synthesis — the
   * multi-step retrieval shape systems like Honcho measure.
   */
  answerMode: (process.env.BENCH_ANSWER_MODE === 'agentic' ? 'agentic' : 'passive') as 'passive' | 'agentic',
  /** Model-driven search rounds after the prefetch. Prefetch itself is uncounted. */
  maxSearchRounds: Number(process.env.BENCH_MAX_SEARCH_ROUNDS ?? 4),
  repoRoot: REPO_ROOT,
  datasetsDir: path.join(REPO_ROOT, 'benchmarks/memory/datasets'),
  resultsDir: path.join(REPO_ROOT, 'benchmarks/memory/results'),
}

export function assertBenchConfig(): void {
  if (!config.convexUrl) throw new Error('DEV_NEXT_PUBLIC_CONVEX_URL (or BENCH_CONVEX_URL) is required')
  if (!config.serverSecret) throw new Error('INTERNAL_API_SECRET is required')
  if (!config.gatewayApiKey) throw new Error('AI_GATEWAY_API_KEY is required')
  // Hard guard: benchmarks write real rows — never point them at production.
  // CONVEX_DEPLOYMENT carries the deployment kind ("dev:<host>" / "prod:<host>").
  const deployment = process.env.CONVEX_DEPLOYMENT ?? ''
  const benchHost = hostOf(config.convexUrl)
  const isProdDeployment = deployment.startsWith('dev:')
    ? false // explicitly a dev deployment
    : deployment.startsWith('prod:')
      ? deployment.includes(benchHost)
      : hostOf(config.prodConvexUrl) === benchHost && benchHost !== ''
  if (isProdDeployment && !process.env.BENCH_ALLOW_PROD) {
    throw new Error(
      `Refusing to run against production Convex (${benchHost}). ` +
      'Set BENCH_CONVEX_URL to a dev deployment, or BENCH_ALLOW_PROD=1 if you really mean it.',
    )
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Synthetic owner per (case, run). Run-scoped ids keep concurrent or repeated
 * runs from sharing a store — a prior run's cleanup can never poison the next
 * run's resume. Callers without a scope (smoke, one-off scripts) keep the
 * legacy dataset-scoped shape.
 */
export function benchUserId(dataset: string, caseId: string, scope?: string): string {
  return scope ? `bench-${scope}-${caseId}` : `bench-${dataset}-${caseId}`
}

export function fingerprint(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex')
}
