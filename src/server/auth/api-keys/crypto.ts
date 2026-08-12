import 'server-only'

import { createHmac, randomBytes } from 'node:crypto'

export const API_KEY_PREFIX = 'ovl_sk_'
export const API_KEY_RANDOM_BYTES = 32
export const API_KEY_SECRET_LENGTH = 43
export const API_KEY_LENGTH = API_KEY_PREFIX.length + API_KEY_SECRET_LENGTH

const API_KEY_HASH_DOMAIN = 'overlay_api_key:v1:'
const API_KEY_PATTERN = /^ovl_sk_[A-Za-z0-9_-]{43}$/

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString('base64url')}`
}

export function isApiKeyCandidate(value: string | null | undefined): value is string {
  const trimmed = value?.trim()
  return Boolean(trimmed && API_KEY_PATTERN.test(trimmed))
}

function getApiKeyHashSecret(): string {
  const dedicated = process.env.API_KEY_HASH_SECRET?.trim()
  if (dedicated) return dedicated

  if (process.env.NODE_ENV === 'production') {
    throw new Error('API_KEY_HASH_SECRET is required for API key hashing in production')
  }

  // In development, fall back to INTERNAL_API_SECRET but never to a hardcoded
  // string. This ensures local dev works without a dedicated secret while
  // preventing a weak hardcoded secret from leaking to production.
  const fallback = process.env.INTERNAL_API_SECRET?.trim()
  if (!fallback) {
    throw new Error(
      'API_KEY_HASH_SECRET (or INTERNAL_API_SECRET as dev fallback) is required for API key hashing.',
    )
  }
  return fallback
}

export function hashApiKey(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (!isApiKeyCandidate(trimmed)) {
    throw new Error('Invalid API key format')
  }
  return createHmac('sha256', getApiKeyHashSecret())
    .update(API_KEY_HASH_DOMAIN)
    .update(trimmed)
    .digest('hex')
}
