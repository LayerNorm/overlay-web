/** Caps the tool values and text an assistant reply stores, so every save stage stays within storage limits. */

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

const STORAGE_TRUNCATION_MARKER = /\n\n\[truncated \d+ chars for storage\]$/
/** Room for the marker itself, so text this file already truncated is recognised as done. */
const MAX_STORAGE_MARKER_CHARS = 48

/** Text this file already cut to `maxChars`: compacting it again must leave it alone. */
function isTruncatedForPersistence(text: string, maxChars: number): boolean {
  return text.length <= maxChars + MAX_STORAGE_MARKER_CHARS && STORAGE_TRUNCATION_MARKER.test(text)
}

/** A tool value this file already replaced with `{ truncated, summary }` (web sources may ride along). */
function isCompactedToolValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.truncated === true
    && typeof record.summary === 'string'
    && isTruncatedForPersistence(record.summary, MAX_PERSISTED_TOOL_VALUE_CHARS)
    && Object.keys(record).every(key => key === 'truncated' || key === 'summary' || key === 'sources')
}

/**
 * Caps a tool input or output for storage. Every save stage (live progress, model stream, transcript, delivery,
 * message save) runs this over parts an earlier stage already compacted, so it must be idempotent: re-wrapping a
 * wrapper nested the value deeper on each pass and filled its budget with escape characters.
 */
export function compactToolValueForPersistence(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    return isTruncatedForPersistence(value, MAX_PERSISTED_TOOL_VALUE_CHARS)
      ? value
      : truncateForPersistence(value, MAX_PERSISTED_TOOL_VALUE_CHARS)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (isCompactedToolValue(value)) return value

  const serialized = stringifyForPersistence(value)
  if (serialized.length <= MAX_PERSISTED_TOOL_VALUE_CHARS) {
    return clampNestingDepth(value)
  }
  return {
    truncated: true,
    summary: truncateForPersistence(serialized, MAX_PERSISTED_TOOL_VALUE_CHARS),
  }
}

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
