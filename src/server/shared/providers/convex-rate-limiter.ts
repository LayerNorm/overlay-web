import 'server-only'

import type {
  RateLimiter,
  RateLimitResult,
  RateLimitSpec,
} from '@overlay/app-core'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logSecurityEvent } from '@/server/observability/security-events'
import { InMemoryRateLimiter } from './in-memory-rate-limiter'
import { getRateLimitBucketKey } from './rate-limit-keys'

type BackendRateLimitRule = {
  bucket: string
  bucketKey: string
  limit: number
  windowMs: number
}

export class ConvexRateLimiter implements RateLimiter {
  private readonly fallback = new InMemoryRateLimiter()

  async check(scope: string, limits: RateLimitSpec[]): Promise<RateLimitResult> {
    const optimistic: RateLimitResult = {
      allowed: true,
      retryAfterSeconds: 0,
      decisions: limits.map((limit) => ({
        bucket: limit.bucket,
        allowed: true,
        remaining: limit.limit,
        retryAfterSeconds: 0,
      })),
    }

    const backendRules: Array<{ originalIndex: number; rule: BackendRateLimitRule }> = []
    for (const [index, limit] of limits.entries()) {
      const bucketKey = getRateLimitBucketKey(scope, limit)
      if (!bucketKey) continue
      backendRules.push({
        originalIndex: index,
        rule: {
          bucket: limit.bucket,
          bucketKey,
          limit: limit.limit,
          windowMs: limit.windowMs,
        },
      })
    }

    if (backendRules.length === 0) return optimistic

    try {
      const backendResults = await convex.mutation<RateLimitResult['decisions']>(
        'platform/rateLimits:takeManyByServer',
        {
          serverSecret: getInternalApiSecret(),
          rules: backendRules.map(({ rule }) => rule),
        },
        {
          throwOnError: true,
          timeoutMs: 10_000,
          suppressNetworkConsoleError: true,
        },
      )

      if (backendResults && backendResults.length === backendRules.length) {
        const decisions = [...optimistic.decisions]
        for (const [index, decision] of backendResults.entries()) {
          const originalIndex = backendRules[index]?.originalIndex
          if (originalIndex == null) continue
          decisions[originalIndex] = decision
        }
        return {
          allowed: decisions.every((decision) => decision.allowed),
          retryAfterSeconds: Math.max(0, ...decisions.map((decision) => decision.retryAfterSeconds)),
          decisions,
        }
      }
    } catch (error) {
      logSecurityEvent(
        'rate_limit_backend_fallback',
        {
          reason: error instanceof Error ? error.message : String(error),
        },
        'warning',
      )
      if (limits.some((limit) => limit.bucket.startsWith('owner-funded:'))) {
        return {
          allowed: false,
          retryAfterSeconds: 60,
          decisions: limits.map((limit) => ({
            bucket: limit.bucket,
            allowed: !limit.bucket.startsWith('owner-funded:'),
            remaining: 0,
            retryAfterSeconds: limit.bucket.startsWith('owner-funded:') ? 60 : 0,
          })),
        }
      }
    }

    return this.fallback.check(scope, limits)
  }
}
