import 'server-only'

import { createHmac } from 'node:crypto'

const DEVELOPMENT_SECRET = 'development-only-operational-key-hash-secret'

function getOperationalHashSecret(): string {
  const configured = process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.API_KEY_HASH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim()
  if (configured) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error('INTERNAL_SERVICE_AUTH_SECRET is required for operational key hashing in production')
  }

  return DEVELOPMENT_SECRET
}

export function hashOperationalIdentifier(domain: string, value: string): string {
  return createHmac('sha256', getOperationalHashSecret())
    .update(domain)
    .update('\0')
    .update(value)
    .digest('hex')
}
