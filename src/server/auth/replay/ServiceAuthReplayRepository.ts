import 'server-only'

import type { ServiceAuthPayload } from '@/server/auth/service-auth'

export interface ServiceAuthReplayRepository {
  consume(payload: ServiceAuthPayload): Promise<boolean>
  cleanupExpired(args?: { limit?: number; now?: number }): Promise<number>
}
