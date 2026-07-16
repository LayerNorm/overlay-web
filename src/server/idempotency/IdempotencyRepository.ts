import 'server-only'

export type CachedIdempotencyHeader = {
  name: string
  value: string
}

export type IdempotencyReservationResult = {
  status: 'reserved' | 'replay' | 'in_flight' | 'conflict'
  responseStatus?: number
  responseHeaders?: CachedIdempotencyHeader[]
  responseBody?: string
}

export interface IdempotencyRepository {
  reserve(args: {
    expiresAt: number
    keyHash: string
    method: string
    path: string
    requestHash: string
    userId: string
  }): Promise<IdempotencyReservationResult>
  complete(args: {
    keyHash: string
    requestHash: string
    responseBody: string
    responseHeaders: CachedIdempotencyHeader[]
    responseStatus: number
  }): Promise<boolean>
  completeStreamStarted(args: { keyHash: string; requestHash: string }): Promise<boolean>
  discard(args: { keyHash: string; requestHash: string }): Promise<boolean>
  cleanupExpired(args?: { limit?: number; now?: number }): Promise<number>
}
