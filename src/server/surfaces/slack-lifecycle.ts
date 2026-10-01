import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SurfaceConnectionStatus } from '@overlay/workspace-contracts'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

/** Slack lifecycle events the Chat SDK does not dispatch — handled by the webhook route directly. */
export const SLACK_LIFECYCLE_EVENT_TYPES = ['app_uninstalled', 'tokens_revoked'] as const
export type SlackLifecycleEventType = (typeof SLACK_LIFECYCLE_EVENT_TYPES)[number]

export type SlackLifecycleAction = {
  type: SlackLifecycleEventType
  /** Slack team_id the event applies to. */
  teamId?: string
  /** Slack enterprise_id — present for org-level installs. */
  enterpriseId?: string
}

type SlackEventEnvelope = {
  type?: string
  team_id?: string
  enterprise_id?: string
  authorizations?: Array<{ team_id?: string; enterprise_id?: string }>
  event?: {
    type?: string
    tokens?: { oauth?: string[]; bot?: string[] }
  }
}

/**
 * Reads a raw Slack Events API body and returns the lifecycle action it
 * carries, or null when it isn't one. `tokens_revoked` only counts when a
 * *bot* token was revoked — user OAuth revocations don't affect the
 * installation's bot token (uninstalls fire `app_uninstalled` anyway).
 * Pure: parsing lives here so the webhook route stays a thin guard.
 */
export function extractSlackLifecycleAction(body: string): SlackLifecycleAction | null {
  let envelope: SlackEventEnvelope
  try {
    envelope = JSON.parse(body) as SlackEventEnvelope
  } catch (_error) {
    return null
  }
  if (envelope?.type !== 'event_callback' || !envelope.event) return null
  const type = envelope.event.type as SlackLifecycleEventType | undefined
  if (!type || !SLACK_LIFECYCLE_EVENT_TYPES.includes(type)) return null
  if (type === 'tokens_revoked' && !(envelope.event.tokens?.bot?.length)) {
    return null
  }
  const authorization = envelope.authorizations?.[0]
  return {
    type,
    teamId: envelope.team_id ?? authorization?.team_id,
    enterpriseId: envelope.enterprise_id ?? authorization?.enterprise_id,
  }
}

const SLACK_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Verifies `v0=` Slack request signing on events we handle outside the Chat
 * SDK (the adapter verifies signatures itself for everything it processes).
 * Rejects stale timestamps inside the same window Slack prescribes.
 */
export function verifySlackRequestSignature(args: {
  headers: Headers
  body: string
  signingSecret: string
  now?: number
}): boolean {
  const timestamp = args.headers.get('x-slack-request-timestamp')
  const signature = args.headers.get('x-slack-signature')
  if (!timestamp || !signature || !args.signingSecret) return false
  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs)) return false
  if (Math.abs((args.now ?? Date.now()) - timestampMs) > SLACK_SIGNATURE_TOLERANCE_MS) return false
  const expected = `v0=${createHmac('sha256', args.signingSecret)
    .update(`v0:${timestamp}:${args.body}`)
    .digest('hex')}`
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(signature)
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)
}

/** Slack error names that mean the installation's bot token is dead. */
const SLACK_REVOKED_TOKEN_ERRORS = new Set([
  'token_revoked',
  'account_inactive',
  'invalid_auth',
  'not_authed',
])

/**
 * Detects a revoked/dead bot token in a Slack Web API failure. The web-api
 * client throws `WebAPIPlatformError` payloads shaped `{ data: { error } }`;
 * adapter wrappers can surface the code on the error itself.
 */
export function isSlackTokenRevokedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { data?: { error?: unknown }; error?: unknown; code?: unknown }
  const codes = [candidate.data?.error, candidate.error, candidate.code]
  return codes.some((code) => typeof code === 'string' && SLACK_REVOKED_TOKEN_ERRORS.has(code))
}

/**
 * Marks the connection for a Slack team degraded (or uninstalled) so inbound
 * routing and outbound replies stop until it is reconnected. Used by both the
 * lifecycle-event webhook path and outbound API calls that discover a dead
 * token at send time. The bootstrap import is deferred so reply/directory
 * modules don't cycle with server context construction.
 */
export async function degradeSlackConnectionByTeam(args: {
  teamId?: string | null
  enterpriseId?: string | null
  status: Exclude<SurfaceConnectionStatus, 'active'>
  reason: string
}): Promise<void> {
  try {
    const { getOverlayServerContext } = await import('@/server/bootstrap')
    const surfaceService = getOverlayServerContext().surfaceService
    const updated = await surfaceService.degradeConnectionByTeam({
      platform: 'slack',
      teamId: args.teamId ?? null,
      enterpriseId: args.enterpriseId ?? null,
      status: args.status,
    })
    if (updated) {
      logger.warn('[surfaces/slack] connection marked non-active', {
        teamId: args.teamId,
        status: args.status,
        reason: args.reason,
      })
    }
  } catch (error) {
    logger.warn('[surfaces/slack] failed to mark connection non-active', {
      teamId: args.teamId,
      status: args.status,
      reason: args.reason,
      error: summarizeErrorForLog(error),
    })
  }
}
