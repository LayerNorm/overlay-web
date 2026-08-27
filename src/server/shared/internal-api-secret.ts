import 'server-only'

import { timingSafeEqual } from 'node:crypto'

export function getInternalApiSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is not configured')
  }
  return secret
}

/**
 * Constant-time compare for the internal service secret. Compares byte length
 * rather than string length: a multibyte header can match on characters while
 * producing a longer buffer, which would make timingSafeEqual throw.
 */
export function matchesInternalApiSecret(supplied: string | null | undefined, expected: string): boolean {
  if (!supplied) return false
  const suppliedBuffer = Buffer.from(supplied, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (suppliedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(suppliedBuffer, expectedBuffer)
}
