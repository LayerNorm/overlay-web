export interface RateLimitSpec {
  bucket: string
  key?: string | null | undefined
  limit: number
  windowMs: number
}

export interface RateLimitDecision {
  bucket: string
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  resetAt?: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  decisions: RateLimitDecision[]
}

export interface RateLimiter {
  check(key: string, limits: RateLimitSpec[]): Promise<RateLimitResult>
}

export interface EventBus {
  publish(topic: string, payload: unknown): Promise<void>
  subscribe(topic: string, handler: (payload: unknown) => void): () => void
}
