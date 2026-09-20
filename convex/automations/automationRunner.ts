import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

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

  return 'https://getoverlay.io'
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

export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const runIds = await ctx.runMutation(internal.automations.automations.claimDueRuns, {
      now: Date.now(),
      limit: 25,
    })

    for (const runId of runIds) {
      await ctx.scheduler.runAfter(0, internal.automations.automationRunner.runAutomation, {
        runId,
      })
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
    const turnId = `automation-${args.runId}-${now}`
    // Runs always target the automation-owned thread. sourceConversationId is
    // provenance only and is never an execution target.
    const existingConversationId = automation.conversationId as
      | Id<'conversations'>
      | undefined
    await ctx.runMutation(internal.automations.automations.markRunStarted, {
      runId: args.runId,
      conversationId: existingConversationId,
      turnId,
      now,
    })

    try {
      const runPath = '/api/v1/automations/run'
      const serviceAuthToken = await buildServiceAuthToken({
        userId: automation.userId,
        method: 'POST',
        path: runPath,
      })
      const response = await fetch(`${getAutomationRunnerBaseUrl()}${runPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SERVICE_AUTH_HEADER]: serviceAuthToken,
        },
        body: JSON.stringify({
          runId: args.runId,
        }),
      })

      if (!response.ok) {
        // 409 means the run is no longer in 'running' — already dispatched
        // (duplicate action delivery) or already terminal. Either way another
        // owner exists; do not mark it failed out from under them.
        if (response.status === 409) return null
        const text = await response.text().catch(() => '')
        throw new Error(text || `Automation runner returned ${response.status}`)
      }

      const result = await response.json().catch(() => ({})) as {
        conversationId?: Id<'conversations'>
        durable?: boolean
      }
      // Durable dispatches settle run status inside the workflow's own steps —
      // marking completed here would finish the run while the turn still runs.
      if (!result.durable) {
        await ctx.runMutation(internal.automations.automations.markRunCompleted, {
          runId: args.runId,
          conversationId: result.conversationId ?? existingConversationId,
          now: Date.now(),
        })
      }
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
