import 'server-only'

import { createClient } from 'redis'
import type {
  RateLimitDecision,
  RateLimiter,
  RateLimitResult,
  RateLimitSpec,
} from '@overlay/app-core'
import { logSecurityEvent } from '@/server/observability/security-events'
import { InMemoryRateLimiter } from './in-memory-rate-limiter'
import { getRateLimitBucketKey } from './rate-limit-keys'

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`

export type RedisRateLimitTakeResult = {
  count: number
  ttlMs: number
}

export interface RedisRateLimitStore {
  take(key: string, windowMs: number): Promise<RedisRateLimitTakeResult>
}

export type RedisRateLimitFailureMode = 'deny' | 'memory'

export class TcpRedisRateLimitStore implements RedisRateLimitStore {
  private readonly client
  private connecting: Promise<void> | null = null

  constructor(
    url: string,
    private readonly prefix = 'overlay:rate-limit:',
  ) {
    this.client = createClient({ url })
    this.client.on('error', () => {})
  }

  async take(key: string, windowMs: number): Promise<RedisRateLimitTakeResult> {
    await this.ensureConnected()
    const result = await this.client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [`${this.prefix}${key}`],
      arguments: [String(windowMs)],
    })
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis rate-limit script returned an invalid result')
    }
    const count = Number(result[0])
    const ttlMs = Number(result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      throw new Error('Redis rate-limit script returned non-numeric values')
    }
    return { count, ttlMs: Math.max(0, ttlMs) }
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.close()
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) return
    this.connecting ??= this.client.connect().then(() => undefined).finally(() => {
      this.connecting = null
    })
    await this.connecting
  }
}

type UpstashPipelineEntry = {
  result?: unknown
  error?: string
}

export class UpstashRedisRateLimitStore implements RedisRateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly prefix = 'overlay:rate-limit:',
  ) {}

  async take(key: string, windowMs: number): Promise<RedisRateLimitTakeResult> {
    const redisKey = `${this.prefix}${key}`
    const response = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(windowMs), 'NX'],
        ['PTTL', redisKey],
      ]),
    })
    if (!response.ok) {
      throw new Error(`Redis rate-limit request failed with HTTP ${response.status}`)
    }
    const payload = await response.json() as UpstashPipelineEntry[]
    const count = numberResult(payload[0])
    const ttlMs = numberResult(payload[2])
    if (count === null || ttlMs === null) {
      throw new Error('Redis rate-limit pipeline returned an invalid result')
    }
    return { count, ttlMs: Math.max(0, ttlMs) }
  }
}

export class RedisRateLimiter implements RateLimiter {
  private readonly fallback: RateLimiter

  constructor(private readonly options: {
    failureMode: RedisRateLimitFailureMode
    store: RedisRateLimitStore
    fallback?: RateLimiter
  }) {
    this.fallback = options.fallback ?? new InMemoryRateLimiter()
  }

  async check(scope: string, limits: RateLimitSpec[]): Promise<RateLimitResult> {
    const now = Date.now()
    const decisions: RateLimitDecision[] = []

    try {
      for (const limit of limits) {
        const bucketKey = getRateLimitBucketKey(scope, limit)
        if (!bucketKey) {
          decisions.push({
            bucket: limit.bucket,
            allowed: true,
            remaining: limit.limit,
            retryAfterSeconds: 0,
          })
          continue
        }

        const result = await this.options.store.take(bucketKey, limit.windowMs)
        const allowed = result.count <= limit.limit
        decisions.push({
          bucket: limit.bucket,
          allowed,
          remaining: allowed ? Math.max(0, limit.limit - result.count) : 0,
          retryAfterSeconds: result.ttlMs > 0 ? Math.max(1, Math.ceil(result.ttlMs / 1000)) : 0,
          resetAt: now + result.ttlMs,
        })
      }
    } catch (error) {
      logSecurityEvent('redis_rate_limit_backend_failed', {
        failureMode: this.options.failureMode,
        reason: error instanceof Error ? error.message : String(error),
      }, 'error')
      if (this.options.failureMode === 'memory') {
        return this.fallback.check(scope, limits)
      }
      return denyAll(limits)
    }

    return summarize(decisions)
  }
}

function denyAll(limits: RateLimitSpec[]): RateLimitResult {
  const decisions = limits.map((limit): RateLimitDecision => ({
    bucket: limit.bucket,
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(limit.windowMs / 1000)),
  }))
  return summarize(decisions)
}

function summarize(decisions: RateLimitDecision[]): RateLimitResult {
  return {
    allowed: decisions.every((decision) => decision.allowed),
    retryAfterSeconds: Math.max(0, ...decisions.map((decision) => decision.retryAfterSeconds)),
    decisions,
  }
}

function numberResult(entry: UpstashPipelineEntry | undefined): number | null {
  const value = entry?.result
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
