import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { generateText } from '@/server/ai/sdk'
import { convex } from '@/server/database/convex'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { DEFAULT_CHAT_SUGGESTIONS } from '@/shared/chat/chat-suggestions-defaults'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getOverlaySession } from '@/server/auth/session'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizePrompt(prompt: string, firstName?: string): string | null {
  let next = prompt.trim()
  if (!next) return null

  next = next.replace(/^['"“”]+|['"“”]+$/g, '').trim()
  next = next.replace(/^(?:hey|hi|hello)\s+[^,!:;.-]*[,!:;.-]+\s*/i, '')

  const trimmedFirstName = firstName?.trim()
  if (trimmedFirstName) {
    const escaped = escapeRegExp(trimmedFirstName)
    next = next.replace(new RegExp(`^${escaped}\\b\\s*[,!:;.-]+\\s*`, 'i'), '')
  }

  next = next.replace(/\boverlay\b/gi, '').replace(/\s{2,}/g, ' ').trim()
  next = next.replace(/^[,!:;.-]+\s*/, '').trim()

  if (!next) return null
  if (/\boverlay\b/i.test(next)) return null
  if (trimmedFirstName && new RegExp(`\\b${escapeRegExp(trimmedFirstName)}\\b`, 'i').test(next)) {
    return null
  }

  return next
}

function normalizeFourPrompts(raw: string[], firstName?: string): string[] {
  const strings = raw
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => sanitizePrompt(p, firstName) ?? '')
    .filter((p) => p.length > 0)
  const out: string[] = [...strings.slice(0, 4)]
  for (const d of DEFAULT_CHAT_SUGGESTIONS) {
    if (out.length >= 4) break
    if (!out.includes(d)) out.push(d)
  }
  while (out.length < 4) {
    out.push(DEFAULT_CHAT_SUGGESTIONS[out.length % DEFAULT_CHAT_SUGGESTIONS.length]!)
  }
  return out.slice(0, 4)
}

const DEFAULT_PROMPTS_NORMALIZED = normalizeFourPrompts([...DEFAULT_CHAT_SUGGESTIONS])

async function generateStartersWithLLM(accessToken: string, firstName: string): Promise<string[] | null> {
  const model = await getLanguageModel(FREE_TIER_AUTO_MODEL_ID, accessToken)
  const result = await generateText({
    model,
    temperature: 0.88,
    maxOutputTokens: 700,
    prompt: `Generate exactly 4 conversation starter prompts for an AI chat app. Each prompt:
- One clear sentence, 8–22 words
- Specific, actionable, and phrased as a task the assistant can help complete
- Cover a mix: coding/tools, research/learning, writing/communication, and a practical work or life task
- No two prompts on the same narrow topic
- Do not address the user directly by name
- Do not mention the app, assistant, or brand name "Overlay"
- Prefer concrete verbs like draft, plan, summarize, analyze, organize, compare, or create

Reply with ONLY valid JSON (no markdown fences) in this exact shape:
{"prompts":["...","...","...","..."]}`,
  })

  const raw = result.text.trim()
  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const parsed = JSON.parse(jsonStr) as { prompts?: unknown }
  const promptsUnknown = parsed.prompts
  if (!Array.isArray(promptsUnknown)) return null
  const strings = promptsUnknown
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => sanitizePrompt(p, firstName) ?? '')
    .filter((p) => p.length > 0)
  return normalizeFourPrompts(strings, firstName)
}

type PersistArgs = {
  serverSecret: string
  userId: string
  prompts: string[]
  day: string
}

async function persistStarters({ serverSecret, userId, prompts, day }: PersistArgs): Promise<boolean> {
  try {
    const result = (await convex.mutation('auth/users:setChatStartersByServer', {
      serverSecret,
      userId,
      prompts,
      day,
    })) as { ok?: boolean }
    return result.ok === true
  } catch (err) {
    logger.error('[chat-suggestions] failed to persist starters', err)
    return false
  }
}

/**
 * Daily refresh after UTC midnight: regenerate (or roll defaults if no first name).
 * Runs after the response is sent (stale-while-revalidate).
 */
function scheduleRefreshForNewDay(args: {
  serverSecret: string
  userId: string
  accessToken: string
  firstName: string
  today: string
}) {
  const { serverSecret, userId, accessToken, firstName, today } = args
  after(async () => {
    try {
      const trimmed = firstName.trim()
      if (!trimmed) {
        await persistStarters({
          serverSecret,
          userId,
          prompts: DEFAULT_PROMPTS_NORMALIZED,
          day: today,
        })
        return
      }
      const generated = await generateStartersWithLLM(accessToken, trimmed)
      if (generated && generated.length === 4) {
        await persistStarters({ serverSecret, userId, prompts: generated, day: today })
      }
    } catch (err) {
      logger.warn('[chat-suggestions] background refresh failed', err)
    }
  })
}

export async function GET(request: Request, context: AppApiRouteContext) {
  try {
    const session = await getOverlaySession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = context.auth.userId

    const serverSecret = getInternalApiSecret()
    const today = utcDateKey()
    const firstName = session.user.id === userId ? session.user.firstName?.trim() ?? '' : ''

    const cached = await convex.query<{ prompts: string[]; day: string } | null>('auth/users:getChatStartersByServer', {
      serverSecret,
      userId,
    })

    if (cached && cached.day === today && cached.prompts.length === 4) {
      return NextResponse.json({ prompts: normalizeFourPrompts(cached.prompts, firstName), stale: false })
    }

    // Yesterday's (or older) starters: return immediately, refresh for the new UTC day in the background
    if (cached && cached.prompts.length === 4 && cached.day !== today) {
      const prompts = normalizeFourPrompts(cached.prompts, firstName)
      scheduleRefreshForNewDay({
        serverSecret,
        userId,
        accessToken: context.auth.accessToken || session.accessToken,
        firstName,
        today,
      })
      return NextResponse.json({ prompts, stale: true })
    }

    // No personalization signal: skip LLM, persist defaults for today so loads stay cheap
    if (!firstName) {
      const prompts = DEFAULT_PROMPTS_NORMALIZED
      await persistStarters({ serverSecret, userId, prompts, day: today })
      return NextResponse.json({ prompts, stale: false })
    }

    let generated: string[] | null = null
    try {
      generated = await generateStartersWithLLM(session.accessToken, firstName)
    } catch (err) {
      logger.warn('[chat-suggestions] generation failed', err)
    }

    if (generated && generated.length === 4) {
      await persistStarters({ serverSecret, userId, prompts: generated, day: today })
      return NextResponse.json({ prompts: generated, stale: false })
    }

    if (cached && cached.prompts.length === 4) {
      return NextResponse.json({ prompts: normalizeFourPrompts(cached.prompts, firstName), stale: false })
    }

    return NextResponse.json({ prompts: [...DEFAULT_CHAT_SUGGESTIONS], stale: false })
  } catch (err) {
    logger.error('[chat-suggestions]', err)
    return NextResponse.json({ prompts: [...DEFAULT_CHAT_SUGGESTIONS], stale: false })
  }
}
