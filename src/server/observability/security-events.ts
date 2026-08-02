import 'server-only'

import { logger } from '@/server/observability/logger'
import * as Sentry from '@sentry/nextjs'
import { publicEnv } from '@/shared/env/public-env'
import { serverEnv } from '@/server/env/server-env'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'
import { getOverlayRuntimeConfigSync } from '@/server/config'

type SecurityEventLevel = 'info' | 'warning' | 'error'

function sentryEnabled(): boolean {
  const feature = process.env.OVERLAY_FEATURE_ERROR_REPORTING?.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(feature ?? '')) return false
  try {
    const config = getOverlayRuntimeConfigSync()
    const provider = config.providers.errorReporting?.provider ?? 'sentry'
    return config.features.errorReporting !== false && provider === 'sentry' && Boolean(serverEnv.sentryDsn || publicEnv.sentryDsn)
  } catch (_error) {
    return false
  }
}

export function logSecurityEvent(
  type: string,
  details: Record<string, unknown>,
  level: SecurityEventLevel = 'warning',
) {
  const payload = {
    type,
    level,
    timestamp: new Date().toISOString(),
    ...details,
  }

  if (level === 'error') {
    logger.error('[SecurityEvent]', payload)
  } else if (level === 'info') {
    logger.info('[SecurityEvent]', payload)
  } else {
    logger.warn('[SecurityEvent]', payload)
  }

  if (!sentryEnabled()) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setTag('security_event', type)
    scope.setLevel(level === 'error' ? 'error' : level === 'info' ? 'info' : 'warning')
    scope.setContext('security_event', sanitizeSecurityDetails(details))
    Sentry.captureMessage(`security_event:${type}`)
  })
}

function sanitizeSecurityDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeSentryEvent({ extra: details })
  return sanitized.extra
}
