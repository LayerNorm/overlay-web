import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ServiceAuthPayload } from '@/server/auth/service-auth'
import type { ServiceAuthReplayRepository } from './ServiceAuthReplayRepository'

export class ConvexServiceAuthReplayRepository implements ServiceAuthReplayRepository {
  async consume(payload: ServiceAuthPayload): Promise<boolean> {
    const result = await convex.mutation<{ consumed: boolean }>(
      'auth/serviceAuth:consumeReplayNonceByServer',
      {
        serverSecret: getInternalApiSecret(),
        expiresAt: payload.exp,
        jti: payload.jti,
        method: payload.method,
        path: payload.path,
        subject: payload.sub,
      },
      { throwOnError: true, timeoutMs: 10_000 },
    )
    return result?.consumed === true
  }

  async cleanupExpired(args: { limit?: number; now?: number } = {}): Promise<number> {
    const result = await convex.mutation<{ deleted: number }>(
      'auth/serviceAuth:cleanupExpiredReplayNoncesByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true, timeoutMs: 10_000 },
    )
    return result?.deleted ?? 0
  }
}
