import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  IdempotencyRepository,
  IdempotencyReservationResult,
} from './IdempotencyRepository'

export class ConvexIdempotencyRepository implements IdempotencyRepository {
  async reserve(args: {
    expiresAt: number
    keyHash: string
    method: string
    path: string
    requestHash: string
    userId: string
  }): Promise<IdempotencyReservationResult> {
    const result = await convex.mutation<IdempotencyReservationResult>(
      'platform/idempotency:reserveByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true },
    )
    if (!result) throw new Error('Convex idempotency reservation returned no result')
    return result
  }

  async complete(args: {
    keyHash: string
    requestHash: string
    responseBody: string
    responseHeaders: Array<{ name: string; value: string }>
    responseStatus: number
  }): Promise<boolean> {
    const result = await convex.mutation<{ completed: boolean }>(
      'platform/idempotency:completeByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true },
    )
    return result?.completed === true
  }

  async completeStreamStarted(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    const result = await convex.mutation<{ completed: boolean }>(
      'platform/idempotency:completeStreamStartedByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true },
    )
    return result?.completed === true
  }

  async discard(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    const result = await convex.mutation<{ discarded: boolean }>(
      'platform/idempotency:discardByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true },
    )
    return result?.discarded === true
  }

  async cleanupExpired(args: { limit?: number; now?: number } = {}): Promise<number> {
    const result = await convex.mutation<{ deleted: number }>(
      'platform/idempotency:cleanupExpiredByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true },
    )
    return result?.deleted ?? 0
  }
}
