import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { logger } from '@/server/observability/logger'

export type SandboxAlertType =
  | 'meter_tick_failed'
  | 'metering_delayed'
  | 'idle_stop_failed'
  | 'stop_failed'
  | 'cleanup_failed'

export type SandboxAlertContext = {
  leaseId?: string
  environmentId?: string
  computerId?: string
  workspaceId?: string
  provider?: string
  reason?: string
}

const ID_CONTEXT_KEYS = ['leaseId', 'environmentId', 'computerId', 'workspaceId'] as const

export function reportSandboxAlert(type: SandboxAlertType, context: SandboxAlertContext): void {
  const safeContext: SandboxAlertContext = {}
  for (const key of ID_CONTEXT_KEYS) {
    const value = context[key]
    if (typeof value === 'string') safeContext[key] = value.slice(0, 200)
  }
  if (typeof context.provider === 'string') safeContext.provider = context.provider.slice(0, 64)
  if (typeof context.reason === 'string') safeContext.reason = sanitizeReason(context.reason)

  logger.error(`[sandbox-alert] ${type}`, safeContext)

  const extra = Object.fromEntries(
    ID_CONTEXT_KEYS.flatMap((key) => safeContext[key] ? [[key, safeContext[key]]] : []),
  )
  Sentry.captureMessage(`sandbox_alert:${type}`, {
    level: 'error',
    tags: {
      sandbox_alert: type,
      ...(safeContext.provider ? { provider: safeContext.provider } : {}),
    },
    extra,
  })
}

function sanitizeReason(reason: string): string {
  return reason
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b(?:[a-f0-9]{1,4}:){2,}[a-f0-9:]*\b/gi, '[redacted-ip]')
    .replace(/\b(?:sk|tok|token|api[-_]?key|secret)[-_: =]+[A-Za-z0-9._~+/=-]{6,}/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .slice(0, 300)
}
