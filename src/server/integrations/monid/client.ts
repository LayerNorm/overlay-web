import 'server-only'

/**
 * HTTP client for Monid (https://monid.ai/docs), the gateway behind Overlay's Data and APIs tools.
 * Overlay holds one server-side key and one prepaid Monid wallet; each run is charged to the
 * Overlay workspace that asked for it (internal/develop/monid.md).
 */

export const MONID_API_URL = 'https://api.monid.ai'

const REQUEST_TIMEOUT_MS = 60_000
/** A rate limit asking us to wait longer than this is reported instead of waited out. */
const MAX_RETRY_AFTER_MS = 5_000

export type MonidRunStatus = 'READY' | 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'STOPPED' | 'TIMED_OUT'

export const MONID_TERMINAL_STATUSES: ReadonlySet<MonidRunStatus> = new Set([
  'COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT',
])

export type MonidMoney = { value: number; currency: string }

/** Monid's price object (markup applied). Only the fields Overlay reads are typed. */
export type MonidPrice = {
  type: string
  amount?: MonidMoney
  unit?: string
  per?: unknown
  period?: unknown
  selectors?: Array<{ label?: string; key?: string; in?: string }>
  variants?: Array<{ when?: Record<string, unknown>; price?: MonidPrice; label?: string }>
  tiers?: unknown[]
  notes?: string[]
}

export type MonidReportedCost = { currency: string; value: number; unit: 'MICRO_DOLLAR' | 'CENT' | 'DOLLAR' }

export type MonidEndpointCard = {
  provider: string
  providerDisplayName?: string
  endpoint: string
  displayName?: string
  displayDescription?: string
  price?: MonidPrice
  tags?: string[]
  categories?: string[]
  metrics?: { status?: string; runTimeMs?: { p50?: number; p95?: number } }
}

export type MonidInspectResult = MonidEndpointCard & {
  providerName?: string
  description?: string
  summary?: string
  method?: string
  docUrl?: string
  notes?: string[]
  input?: { body?: unknown; queryParams?: unknown; pathParams?: unknown; bodyType?: string }
  alternatives?: Array<{ endpoint: string; label?: string; tags?: string[]; price?: MonidPrice; limits?: string }>
  offer?: { label?: string; limits?: string; regularEndpoint?: string }
}

export type MonidRunInput = {
  body?: Record<string, unknown>
  queryParams?: Record<string, unknown>
  pathParams?: Record<string, unknown>
}

export type MonidRun = {
  runId: string
  provider: string
  endpoint: string
  status: MonidRunStatus
  stoppable?: boolean
  reason?: string
  output?: unknown
  providerResponse?: { httpStatus?: number; error?: unknown }
  price?: MonidPrice
  billing?: { reportedCost?: MonidReportedCost }
  /** What the run cost in dollars. `GET /v1/runs/{id}` reports this instead of `billing.reportedCost`. */
  cost?: MonidMoney
  tag?: string
  resultCount?: number
  billedUnits?: number
  createdAt?: string
  completedAt?: string
}

export class MonidApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The run, for responses that carry one (408 timed out, 502 provider account error). */
    readonly run?: MonidRun,
  ) {
    super(message)
    this.name = 'MonidApiError'
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type MonidClient = ReturnType<typeof createMonidClient>

export function createMonidClient(options: {
  apiKey: string
  fetch?: FetchLike
  baseUrl?: string
  sleep?: (ms: number) => Promise<void>
}) {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? MONID_API_URL
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const data = await response.json().catch((_error) => null) as unknown
      if (response.status === 429 && attempt === 0) {
        const waitMs = retryAfterMs(response.headers.get('retry-after'))
        if (waitMs !== null && waitMs <= MAX_RETRY_AFTER_MS) {
          await sleep(waitMs)
          continue
        }
      }
      if (response.ok) return { status: response.status, data: data as T }
      throw toApiError(response.status, data)
    }
  }

  return {
    /** Ranked endpoints for a plain-language need. Overlay only ever searches read-only endpoints. */
    async discover(args: { query: string; limit?: number; category?: string }): Promise<{ items: MonidEndpointCard[]; total: number }> {
      const { data } = await request<{ items?: MonidEndpointCard[]; total?: number }>('POST', '/v1/discover/endpoints', {
        q: args.query,
        limit: args.limit ?? 8,
        readonly: true,
        ...(args.category ? { category: args.category } : {}),
      })
      return { items: Array.isArray(data?.items) ? data.items : [], total: typeof data?.total === 'number' ? data.total : 0 }
    },

    async inspect(args: { provider: string; endpoint: string }): Promise<MonidInspectResult> {
      const { data } = await request<MonidInspectResult>('POST', '/v1/inspect', { provider: args.provider, endpoint: args.endpoint })
      return data
    },

    /** Starts a run. A synchronous endpoint returns the finished run; an asynchronous one returns it accepted (202). */
    async run(args: {
      provider: string
      endpoint: string
      input?: MonidRunInput
      maxCost?: number
      tag?: string
      idempotencyKey: string
    }): Promise<MonidRun> {
      const { data } = await request<MonidRun>('POST', '/v1/run', {
        provider: args.provider,
        endpoint: args.endpoint,
        ...(args.input ? { input: args.input } : {}),
        ...(args.maxCost !== undefined ? { maxCost: args.maxCost } : {}),
        ...(args.tag ? { tag: args.tag } : {}),
      }, { 'idempotency-key': args.idempotencyKey })
      return data
    },

    async getRun(runId: string): Promise<MonidRun> {
      const { data } = await request<MonidRun>('GET', `/v1/runs/${encodeURIComponent(runId)}`)
      return data
    },

    async stopRun(runId: string): Promise<MonidRun> {
      const { data } = await request<MonidRun>('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {})
      return data
    },

    /**
     * Every endpoint that is not read-only: it creates, changes or deletes resources in Overlay's one Monid workspace
     * (shared by every Overlay customer), or acts outside its own response (calls, messages, bookings). Overlay never
     * runs these. Paged through the public catalog, which needs no key.
     */
    async listSideEffectEndpoints(): Promise<Set<string>> {
      const keys = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ readonly: 'false', limit: '100', ...(cursor ? { cursor } : {}) })
        const { data } = await request<{ items?: MonidEndpointCard[]; cursor?: string }>('GET', `/public/v1/endpoints?${query}`)
        // A page without a readable list would silently shorten the blocklist: refuse instead (fail closed).
        if (!Array.isArray(data?.items)) throw new MonidApiError(502, 'CATALOG_UNREADABLE', 'The Monid side-effect catalog returned no list.')
        for (const item of data.items) keys.add(monidEndpointKey(item.provider, item.endpoint))
        cursor = data?.cursor
        if (!cursor) return keys
      }
      throw new MonidApiError(500, 'CATALOG_TOO_LARGE', 'The Monid side-effect catalog did not finish paging.')
    },
  }
}

export function monidEndpointKey(provider: string, endpoint: string): string {
  return `${provider}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
}

/** Monid's `reportedCost` (what the run costs Overlay) in US dollars. */
export function reportedCostUsd(cost: MonidReportedCost | undefined | null): number | null {
  if (!cost || cost.currency !== 'USD' || !Number.isFinite(cost.value) || cost.value < 0) return null
  if (cost.unit === 'MICRO_DOLLAR') return cost.value / 1_000_000
  if (cost.unit === 'CENT') return cost.value / 100
  if (cost.unit === 'DOLLAR') return cost.value
  return null
}

/**
 * What a finished run costs Overlay, in dollars: `billing.reportedCost` on a synchronous run's response, `cost` on a run
 * read back with `GET /v1/runs/{id}` (asynchronous runs). Null when neither is present.
 */
export function runCostUsd(run: Pick<MonidRun, 'billing' | 'cost'>): number | null {
  const reported = reportedCostUsd(run.billing?.reportedCost)
  if (reported !== null) return reported
  const cost = run.cost
  if (!cost || cost.currency !== 'USD' || !Number.isFinite(cost.value) || cost.value < 0) return null
  return cost.value
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

function toApiError(status: number, data: unknown): MonidApiError {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const code = typeof record.errorCode === 'string' ? record.errorCode
    : typeof record.code === 'string' ? record.code
      : `HTTP_${status}`
  const message = typeof record.message === 'string' ? record.message
    : typeof record.error === 'string' ? record.error
      : `Monid request failed (HTTP ${status})`
  const run = typeof record.runId === 'string' && typeof record.status === 'string' ? record as unknown as MonidRun : undefined
  return new MonidApiError(status, code, message, run)
}
