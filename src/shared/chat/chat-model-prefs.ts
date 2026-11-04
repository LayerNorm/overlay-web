import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModel } from '@/shared/ai/gateway/model-data'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import type { ReasoningLevel } from '@overlay/chat-core'
import { parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

/** Persisted chat model selection — shared with ChatInterface and sidebar "new chat" actions. */
export const CHAT_MODEL_KEY = 'overlay_chat_model'
export const ACT_MODEL_KEY = 'overlay_act_model'

const VALID_REASONING_LEVELS: readonly ReasoningLevel[] = [
  'provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
]
export type ReasoningByModel = Readonly<Record<string, ReasoningLevel | undefined>>

export type ChatReasoningScope =
  | { type: 'thread'; id: string }
  | { type: 'workspace'; id: string }
  | { type: 'temporary'; id: string }

export function isPersistentChatReasoningScope(scope: ChatReasoningScope): boolean {
  return scope.type !== 'temporary'
}

export function chatReasoningStorageKey(scope: ChatReasoningScope): string {
  return `overlay_chat_reasoning_by_model_v1:${scope.type}:${encodeURIComponent(scope.id)}`
}

export function readStoredReasoningByModel(storageKey: string): Record<string, ReasoningLevel> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ReasoningLevel] =>
      entry[0].length > 0 &&
      typeof entry[1] === 'string' &&
      VALID_REASONING_LEVELS.includes(entry[1] as ReasoningLevel) &&
      entry[1] !== 'provider-default',
    ))
  } catch {
    return {}
  }
}

export function writeStoredReasoningByModel(
  storageKey: string,
  reasoningByModel: ReasoningByModel,
): void {
  if (typeof window === 'undefined') return
  try {
    const saved = Object.fromEntries(Object.entries(reasoningByModel).filter(([modelId, level]) =>
      modelId.length > 0 &&
      typeof level === 'string' &&
      VALID_REASONING_LEVELS.includes(level) &&
      level !== 'provider-default',
    ))
    if (Object.keys(saved).length === 0) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(saved))
  } catch {
    /* ignore */
  }
}
function normalizeAskIds(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    const m = getModel(id)
    const resolvedId = m?.id ?? (parseByokModelId(id) ? id : undefined)
    if (!resolvedId || seen.has(resolvedId)) continue
    seen.add(resolvedId)
    out.push(resolvedId)
    break
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
    ask = [resolvedAct]
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
      const ids = typeof parsed === 'string'
        ? [parsed]
        : Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === 'string')
          : []
      const norm = normalizeChatModelSelection({ askModelIds: ids }).askModelIds
      if (norm.length > 0) return norm
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

/** Body fields for POST /api/v1/conversations. Prefers explicit account defaults,
 * then the user\'s most recent text model selection from localStorage, then the paid default. */
export function resolveNewChatModelFields({
  defaultActModelId,
  defaultAskModelIds,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  onlyAllowZdrModels?: boolean
}): {
  askModelIds: string[]
  actModelId: string
  lastMode: 'act'
} {
  const hasConfiguredDefault =
    Boolean(defaultActModelId?.trim()) || Boolean(defaultAskModelIds && defaultAskModelIds.length > 0)

  if (!hasConfiguredDefault) {
    const storedAsk = readStoredAskModelIds()
    const storedAct = readStoredActModelId()
    const storedSelection = normalizeChatModelSelection({
      askModelIds: storedAsk,
      actModelId: storedAct,
      fallbackModelId: DEFAULT_MODEL_ID,
    })
    if (storedSelection.askModelIds.length > 0) {
      return {
        askModelIds: storedSelection.askModelIds,
        actModelId: storedSelection.actModelId,
        lastMode: 'act',
      }
    }
  }

  const selection = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    onlyAllowZdrModels,
  })
  return {
    askModelIds: selection.askModelIds,
    actModelId: selection.actModelId,
    lastMode: 'act',
  }
}
