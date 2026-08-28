import 'server-only'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { RateLimitSpec } from '@overlay/app-core'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getRateLimitBucketKey } from '@/server/shared/providers/rate-limit-keys'
import { logSecurityEvent } from '@/server/observability/security-events'

const requestsWithSatisfiedRateLimits = new WeakSet<NextRequest>()

export function markRateLimitsSatisfied(request: NextRequest): void {
  requestsWithSatisfiedRateLimits.add(request)
}

export function getClientIp(request: Pick<Request, 'headers'>): string {
  const trustProxyHeaders =
    process.env.TRUST_PROXY_HEADERS === 'true' ||
    Boolean(process.env.VERCEL || process.env.CF_PAGES || process.env.CLOUDFLARE_ACCOUNT_ID)
  if (!trustProxyHeaders) return 'unknown'

  const candidates = [
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim(),
    request.headers.get('cf-connecting-ip')?.trim(),
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    request.headers.get('x-real-ip')?.trim(),
  ]
  return candidates.find((value) => Boolean(value)) || 'unknown'
}

export async function rateLimitByIp(
  request: NextRequest,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  return enforceRateLimits(request, [
    { bucket, key: getClientIp(request), limit, windowMs },
  ])
}

export async function enforceRateLimits(
  request: NextRequest,
  rules: RateLimitSpec[],
): Promise<NextResponse | null> {
  if (requestsWithSatisfiedRateLimits.has(request)) return null

  const scope = `${request.method.toUpperCase()} ${request.nextUrl.pathname}`
  const result = await getOverlayServerContext().rateLimiter.check(scope, rules)
  if (result.allowed) return null

  const blockedDecision = result.decisions.find((decision) => !decision.allowed)
  const blockedRule = rules.find((rule) => rule.bucket === blockedDecision?.bucket)

  logSecurityEvent('rate_limit_blocked', {
    bucket: blockedDecision?.bucket ?? blockedRule?.bucket ?? 'unknown',
    keyHash: blockedRule ? getRateLimitBucketKey(scope, blockedRule) : null,
    path: request.nextUrl.pathname,
    method: request.method,
    retryAfterSeconds: result.retryAfterSeconds,
  })

  return NextResponse.json(
    {
      error: 'Too many requests',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    },
  )
}
