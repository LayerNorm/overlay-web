import { compactAssistantPersistenceForConvex } from './persist-assistant-turn'

type Part = Record<string, unknown>

/** Compacts an agent message's parts to fit Convex storage and drops undefined tool fields. */
export function compactAgentParts(parts: Part[]): Part[] {
  return compactAssistantPersistenceForConvex({ content: '', parts }).parts.map((part) => {
    if (part.type !== 'tool-invocation') return part
    const invocation = part.toolInvocation && typeof part.toolInvocation === 'object'
      ? (part.toolInvocation as Record<string, unknown>)
      : {}
    return {
      ...part,
      toolInvocation: Object.fromEntries(Object.entries(invocation).filter(([, value]) => value !== undefined)),
    }
  })
}

function invocationOf(part: Part | undefined): Record<string, unknown> | undefined {
  return part?.type === 'tool-invocation' && part.toolInvocation && typeof part.toolInvocation === 'object'
    ? part.toolInvocation as Record<string, unknown>
    : undefined
}

/**
 * Applies one tool call's live progress to a message's current parts. Calls from one model step run at the same
 * time, so each writes only its own part and the store merges it into whatever is saved now: overlapping calls keep
 * each other's entries, and a late "running" update never reopens a call that already finished. Returns undefined
 * when nothing changes.
 */
export function mergeAgentToolProgressPart(current: Part[], toolPart: Part): Part[] | undefined {
  const next = invocationOf(toolPart)
  const toolCallId = next?.toolCallId
  if (typeof toolCallId !== 'string' || !toolCallId) return undefined
  const parts = current.filter(part => part.type !== 'reasoning')
  const index = parts.findIndex(part => invocationOf(part)?.toolCallId === toolCallId)
  if (index >= 0) {
    if (next?.state === 'input-available' && invocationOf(parts[index])?.state !== 'input-available') return undefined
    parts[index] = toolPart
  } else {
    parts.push(toolPart)
  }
  return compactAgentParts(parts)
}
