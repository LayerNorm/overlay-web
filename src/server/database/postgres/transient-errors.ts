import 'server-only'

const TRANSIENT_POSTGRES_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '40001',
  '40P01',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
])

export function isTransientPostgresError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (error instanceof AggregateError) {
    return error.errors.some(isTransientPostgresError)
  }
  const candidate = error as { cause?: unknown; code?: unknown; message?: unknown }
  if (typeof candidate.code === 'string' && TRANSIENT_POSTGRES_CODES.has(candidate.code)) return true
  if (candidate.cause && isTransientPostgresError(candidate.cause)) return true
  if (typeof candidate.message !== 'string') return false
  return /connection (?:terminated|closed|reset|refused)|server closed the connection|the database system is (?:starting up|shutting down|in recovery)|timeout expired|getaddrinfo|socket hang up/i.test(candidate.message)
}

export async function withTransientPostgresReadRetry<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number
    baseDelayMs?: number
    maximumDelayMs?: number
    random?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(10, Math.floor(options.attempts ?? 4)))
  const baseDelayMs = Math.max(1, Math.floor(options.baseDelayMs ?? 100))
  const maximumDelayMs = Math.max(baseDelayMs, Math.floor(options.maximumDelayMs ?? 2_000))
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? (async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= attempts || !isTransientPostgresError(error)) throw error
      const exponentialDelay = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const jitter = 0.75 + Math.max(0, Math.min(1, random())) * 0.5
      await sleep(Math.max(1, Math.floor(exponentialDelay * jitter)))
    }
  }
  throw new Error('Postgres read retry exhausted unexpectedly')
}
