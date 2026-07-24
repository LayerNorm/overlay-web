/** Request init for POST/PATCH/DELETE — optional stable key for server idempotency (5.5). */
export type MutationRequestInit = RequestInit & {
  idempotencyKey?: string
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `idempotency-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** Strip `idempotencyKey` and set the `Idempotency-Key` header when provided. */
export function toRequestInit(init?: MutationRequestInit): RequestInit {
  if (!init) return {}
  const { idempotencyKey, ...rest } = init
  const trimmed = idempotencyKey?.trim()
  if (!trimmed) return rest
  const headers = new Headers(rest.headers)
  headers.set('Idempotency-Key', trimmed)
  return { ...rest, headers }
}
