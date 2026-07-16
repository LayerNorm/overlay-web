import 'server-only'

import type { RateLimitSpec } from '@overlay/app-core'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'

export function getRateLimitBucketKey(scope: string, spec: RateLimitSpec): string | null {
  const rawKey = spec.key?.trim() || scope.trim()
  if (!rawKey) return null
  const digest = hashOperationalIdentifier('rate-limit-bucket:v1', rawKey)
  return `${spec.bucket}:${digest}`
}
