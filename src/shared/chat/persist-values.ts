const MAX_PERSISTED_TOOL_VALUE_CHARS = 4_000

export function truncateForPersistence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}\n\n[truncated ${text.length - maxChars} chars for storage]`
}

function stringifyForPersistence(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function hasUnsupportedConvexFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => key.startsWith('$') || key.length > 1024
    || /[^\x20-\x7e]/.test(key) || hasUnsupportedConvexFields(child))
}

export function compactToolValueForPersistence(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return truncateForPersistence(value, MAX_PERSISTED_TOOL_VALUE_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return value

  const serialized = stringifyForPersistence(value)
  if (serialized.length <= MAX_PERSISTED_TOOL_VALUE_CHARS) {
    const compacted = clampNestingDepth(value)
    return hasUnsupportedConvexFields(compacted) ? serialized : compacted
  }
  return {
    truncated: true,
    summary: truncateForPersistence(serialized, MAX_PERSISTED_TOOL_VALUE_CHARS),
  }
}

/**
 * Convex documents may not exceed 16 levels of nesting. Tool outputs (e.g. Notion API
 * responses) can easily exceed this. This helper truncates any object/array that is
 * deeper than `maxDepth` levels, replacing it with a sentinel string so the content
 * is still readable but safe to store.
 */
export function clampNestingDepth(value: unknown, maxDepth = 10, currentDepth = 0): unknown {
  if (currentDepth >= maxDepth) {
    if (value === null || value === undefined) return value
    if (typeof value !== 'object') return value
    return '[truncated: too deeply nested]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => clampNestingDepth(item, maxDepth, currentDepth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as object)) {
      result[key] = clampNestingDepth((value as Record<string, unknown>)[key], maxDepth, currentDepth + 1)
    }
    return result
  }
  return value
}
