/** Isomorphic AI SDK UI part helpers (no `ai` package dependency). */

export function getToolName(part: unknown): string {
  if (!part || typeof part !== 'object') return ''
  const p = part as Record<string, unknown>
  if (typeof p.toolName === 'string') return p.toolName
  if (typeof p.name === 'string') return p.name
  const type = typeof p.type === 'string' ? p.type : ''
  if (type.startsWith('tool-')) return type.slice(5)
  return ''
}
export function isToolUIPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const type = (part as { type?: unknown }).type
  return typeof type === 'string' && (type === 'tool' || type === 'dynamic-tool' || type.startsWith('tool-'))
}

export function isReasoningUIPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const type = (part as { type?: unknown }).type
  return type === 'reasoning'
}
