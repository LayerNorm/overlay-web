import {
  DEFAULT_KNOWLEDGE_RETRIEVAL_MODE,
  MAX_KNOWLEDGE_BASES_PER_TURN,
  type KnowledgeRetrievalMode,
} from '@overlay/app-core'

export type RetrievalScopeInput = {
  /** Bases attached to the conversation's project, if any. */
  projectKnowledgeBaseIds?: readonly string[]
  /** Bases attached to the conversation itself. */
  conversationKnowledgeBaseIds?: readonly string[]
  /** Bases named explicitly on this turn, e.g. via `@Knowledge`. */
  mentionedKnowledgeBaseIds?: readonly string[]
  /** Group-distributed fallback bases for an otherwise unscoped conversation. */
  defaultKnowledgeBaseIds?: readonly string[]
  /** Explicit override; defaults to mention-narrows behavior. */
  mode?: KnowledgeRetrievalMode
}

export type RetrievalScope = {
  knowledgeBaseIds: string[]
  mode: KnowledgeRetrievalMode
  /** True when an explicit mention narrowed the scope away from project defaults. */
  narrowedByMention: boolean
}

/**
 * Decides which knowledge bases ground a single turn.
 *
 * An explicit `@Knowledge` mention narrows retrieval to only the mentioned
 * bases, overriding the project's attached set, so users get a precise escape
 * hatch instead of an ever-widening corpus. With no mention, the project's and
 * conversation's attached bases apply. `combined` unions everything.
 */
export function resolveRetrievalScope(input: RetrievalScopeInput): RetrievalScope {
  const mentioned = normalize(input.mentionedKnowledgeBaseIds)
  const conversation = normalize(input.conversationKnowledgeBaseIds)
  const project = normalize(input.projectKnowledgeBaseIds)
  const defaults = normalize(input.defaultKnowledgeBaseIds)
  const attached = union(conversation, project)
  const fallback = attached.length > 0 ? attached : defaults

  const mode: KnowledgeRetrievalMode = input.mode
    ?? (mentioned.length > 0 ? DEFAULT_KNOWLEDGE_RETRIEVAL_MODE : 'project')

  if (mode === 'selected') {
    // A caller may ask for `selected` with nothing mentioned; fall back to the
    // attached sets rather than silently retrieving from nothing.
    const selected = mentioned.length > 0 ? mentioned : fallback
    return finalize(selected, mode, mentioned.length > 0 && fallback.length > 0)
  }
  if (mode === 'combined') {
    return finalize(
      mentioned.length > 0 || attached.length > 0
        ? union(mentioned, attached)
        : defaults,
      mode,
      false,
    )
  }
  return finalize(fallback, 'project', false)
}

function finalize(
  ids: string[],
  mode: KnowledgeRetrievalMode,
  narrowedByMention: boolean,
): RetrievalScope {
  return {
    knowledgeBaseIds: ids.slice(0, MAX_KNOWLEDGE_BASES_PER_TURN),
    mode,
    narrowedByMention,
  }
}

function union(...groups: readonly string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

function normalize(values: readonly string[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}
