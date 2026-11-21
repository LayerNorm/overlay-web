import { fetchAppCallback } from '../lib/appCallback'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'

const SERVICE_AUTH_HEADER = 'x-overlay-service-auth'
const SERVICE_AUTH_AUDIENCE = 'overlay-internal-api'
const SERVICE_AUTH_ISSUER = 'overlay-nextjs'
const DEFAULT_SERVICE_AUTH_TTL_MS = 60_000
const textEncoder = new TextEncoder()

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown automation error'
  }
}

export function getAutomationRunnerBaseUrl(): string {
  const explicit = process.env.AUTOMATION_RUNNER_BASE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (appUrl) return appUrl.replace(/\/+$/, '')

  const vercelUrl = process.env.VERCEL_URL?.trim()
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '')

  const devAppUrl = process.env.DEV_NEXT_PUBLIC_APP_URL?.trim()
  if (devAppUrl) return devAppUrl.replace(/\/+$/, '')

  return 'https://overlay.works'
}

function getInternalApiSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is not configured')
  }
  return secret
}

function getServiceAuthSecret(): string {
  const dedicatedSecret = process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
  const rootSecret = process.env.INTERNAL_API_SECRET?.trim()
  const allowRootFallback = process.env.ALLOW_INTERNAL_SERVICE_AUTH_SECRET_FALLBACK === '1'

  if (dedicatedSecret) {
    if (!allowRootFallback && dedicatedSecret === rootSecret) {
      throw new Error('INTERNAL_SERVICE_AUTH_SECRET must not equal INTERNAL_API_SECRET')
    }
    return dedicatedSecret
  }

  if (allowRootFallback) {
    return getInternalApiSecret()
  }
  throw new Error('INTERNAL_SERVICE_AUTH_SECRET is required for automation runner service auth')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function toBase64Url(value: string): string {
  return bytesToBase64Url(textEncoder.encode(value))
}

async function buildServiceAuthToken(params: {
  userId: string
  method: string
  path: string
  ttlMs?: number
}): Promise<string> {
  const now = Date.now()
  const payload = {
    aud: SERVICE_AUTH_AUDIENCE,
    iss: SERVICE_AUTH_ISSUER,
    jti: crypto.randomUUID(),
    sub: params.userId.trim(),
    method: params.method.trim().toUpperCase(),
    path: params.path.trim() || '/',
    iat: now,
    exp: now + Math.max(1_000, params.ttlMs ?? DEFAULT_SERVICE_AUTH_TTL_MS),
  }
  const payloadSegment = toBase64Url(JSON.stringify(payload))
  const signingKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getServiceAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    textEncoder.encode(payloadSegment),
  )

  return `${payloadSegment}.${bytesToBase64Url(new Uint8Array(signature))}`
}

const RUN_PATH = '/api/v1/automations/run'

/**
 * Asks the app to act on a run: start it when it has not posted its message
 * yet, or settle it from its thread's outcome. Service auth names the owner.
 */
async function postRunToApp(userId: string, runId: string): Promise<Response> {
  const serviceAuthToken = await buildServiceAuthToken({ userId, method: 'POST', path: RUN_PATH })
  return await fetchAppCallback(`${getAutomationRunnerBaseUrl()}${RUN_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SERVICE_AUTH_HEADER]: serviceAuthToken,
    },
    body: JSON.stringify({ runId }),
  })
}

export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const [runIds, settleable] = await Promise.all([
      ctx.runMutation(internal.automations.automations.claimDueRuns, { now, limit: 25 }),
      ctx.runQuery(internal.automations.automations.listSettleableThreadRuns, { now }),
    ])

    await Promise.all([
      ...runIds.map((runId) =>
        ctx.scheduler.runAfter(0, internal.automations.automationRunner.runAutomation, { runId })),
      ...settleable.map((run) =>
        ctx.scheduler.runAfter(0, internal.automations.automationRunner.settleThreadRun, run)),
    ])

    return null
  },
})

// A run's thread turn ended: the app records its outcome on the ledger row
// and publishes the run's lifecycle event. Retried by the next tick on failure.
export const settleThreadRun = internalAction({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const response = await postRunToApp(args.userId, args.runId)
    if (!response.ok && response.status !== 409) {
      const text = await response.text().catch(() => '')
      console.warn('[automations] settling a thread run failed', { runId: args.runId, status: response.status, text: text.slice(0, 300) })
    }
    return null
  },
})

export const runAutomation = internalAction({
  args: {
    runId: v.id('automationRuns'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.automations.automations.getRunForExecution, {
      runId: args.runId,
    })
    if (!payload) return null

    const { run, automation, agentArchived } = payload
    if (run.status !== 'queued') return null

    const now = Date.now()
    // Agent-owned automations do not run while their agent is archived.
    if (agentArchived) {
      await ctx.runMutation(internal.automations.automations.markRunSkipped, {
        runId: args.runId,
        now,
      })
      return null
    }
    // The scheduler only claims the run. The app binds the automation's thread,
    // posts the instructions into it and starts its turn, as for manual runs.
    await ctx.runMutation(internal.automations.automations.markRunStarted, {
      runId: args.runId,
      now,
    })

    try {
      const response = await postRunToApp(automation.userId, args.runId)

      if (!response.ok) {
        // 409 means the run is no longer in 'running' — already dispatched
        // (duplicate action delivery) or already terminal. Either way another
        // owner exists; do not mark it failed out from under them.
        if (response.status === 409) return null
        const text = await response.text().catch(() => '')
        throw new Error(text || `Automation runner returned ${response.status}`)
      }

      // The run stays running while its thread turn works; the minute tick
      // settles it once the turn ends.
    } catch (error) {
      await ctx.runMutation(internal.automations.automations.markRunFailed, {
        runId: args.runId,
        error: summarizeError(error).slice(0, 1000),
        now: Date.now(),
      })
    }

    return null
  },
})
