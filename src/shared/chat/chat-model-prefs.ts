import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModel } from '@/shared/ai/gateway/model-data'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import { parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

/** Persisted chat model selection — shared with ChatInterface and sidebar "new chat" actions. */
export const CHAT_MODEL_KEY = 'overlay_chat_model'
export const ACT_MODEL_KEY = 'overlay_act_model'
function normalizeAskIds(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    const m = getModel(id)
    const resolvedId = m?.id ?? (parseByokModelId(id) ? id : undefined)
    if (!resolvedId || seen.has(resolvedId)) continue
    seen.add(resolvedId)
    out.push(resolvedId)
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
  const resolvedAct = actModelId
    ? getModel(actModelId)?.id ?? (parseByokModelId(actModelId) ? actModelId : undefined)
    : undefined
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
