import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModel } from '@/shared/ai/gateway/model-data'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import type { ReasoningLevel } from '@overlay/chat-core'

/** Persisted chat model selection — shared with ChatInterface and sidebar "new chat" actions. */
export const CHAT_MODEL_KEY = 'overlay_chat_model'
export const ACT_MODEL_KEY = 'overlay_act_model'
export const REASONING_KEY = 'overlay_reasoning_level'

const VALID_REASONING_LEVELS: readonly ReasoningLevel[] = [
  'provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
]
function normalizeAskIds(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    const m = getModel(id)
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m.id)
    if (out.length >= 4) break
  }
  return out
}

export function normalizeChatModelSelection({
  askModelIds,
  actModelId,
  fallbackModelId = DEFAULT_MODEL_ID,
}: {
  askModelIds?: readonly string[]
  actModelId?: string
  fallbackModelId?: string
}): {
  askModelIds: string[]
  actModelId: string
} {
  const fallback = getModel(fallbackModelId)?.id ?? DEFAULT_MODEL_ID
  const resolvedAct = actModelId ? getModel(actModelId)?.id : undefined
  let ask = normalizeAskIds([...(askModelIds ?? [])])

  if (resolvedAct && !ask.includes(resolvedAct)) {
    ask = [resolvedAct, ...ask].slice(0, 4)
  }
  if (ask.length === 0) ask = [resolvedAct ?? fallback]

  const act = resolvedAct && ask.includes(resolvedAct)
    ? resolvedAct
    : ask[0] ?? fallback

  return {
    askModelIds: ask,
    actModelId: act,
  }
}

/** Read preferred Ask slot model ids from localStorage (browser only). */
export function readStoredAskModelIds(): string[] {
  if (typeof window === 'undefined') return [DEFAULT_MODEL_ID]
  try {
    const saved = localStorage.getItem(CHAT_MODEL_KEY)
    if (!saved) return [DEFAULT_MODEL_ID]
    try {
      const parsed = JSON.parse(saved) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        const ids = parsed.filter((id): id is string => typeof id === 'string')
        const norm = normalizeChatModelSelection({ askModelIds: ids }).askModelIds
        if (norm.length > 0) return norm
      }
    } catch {
      const norm = normalizeChatModelSelection({ askModelIds: [saved] }).askModelIds
      if (norm.length > 0) return norm
    }
  } catch {
    /* ignore */
  }
  return [DEFAULT_MODEL_ID]
}

/** Read preferred Act model from localStorage. */
export function readStoredActModelId(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID
  try {
    const saved = localStorage.getItem(ACT_MODEL_KEY)?.trim()
    if (saved) {
      return normalizeChatModelSelection({
        askModelIds: readStoredAskModelIds(),
        actModelId: saved,
      }).actModelId
    }
  } catch {
    /* ignore */
  }
  return readStoredAskModelIds()[0] ?? DEFAULT_MODEL_ID
}

/** Body fields for POST /api/v1/conversations — server clamps models for free tier. */
export function resolveNewChatModelFields({
  defaultActModelId,
  defaultAskModelIds,
  isFreeTier = false,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  isFreeTier?: boolean
  onlyAllowZdrModels?: boolean
}): {
  askModelIds: string[]
  actModelId: string
  lastMode: 'act'
} {
  const selection = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    isFreeTier,
    onlyAllowZdrModels,
  })
  return {
    askModelIds: selection.askModelIds,
    actModelId: selection.actModelId,
    lastMode: 'act',
  }
}

/** @deprecated Use {@link resolveNewChatModelFields} with app settings instead. */
export function readNewChatModelFieldsFromStorage(): {
  askModelIds: string[]
  actModelId: string
  lastMode: 'act'
} {
  return resolveNewChatModelFields({})
}

/** Read preferred reasoning level from localStorage (browser only). */
export function readStoredReasoningLevel(): ReasoningLevel | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const saved = localStorage.getItem(REASONING_KEY)?.trim()
    if (saved && VALID_REASONING_LEVELS.includes(saved as ReasoningLevel)) {
      return saved as ReasoningLevel
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/** Persist reasoning level to localStorage (browser only). */
export function writeStoredReasoningLevel(level: ReasoningLevel): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(REASONING_KEY, level)
  } catch {
    /* ignore */
  }
}
