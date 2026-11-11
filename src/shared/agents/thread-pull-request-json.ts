const MAX_FINGERPRINT_LENGTH = 64_000
export const MAX_TEXT_LENGTH = 16_384
const MAX_OBJECT_KEYS = 128
export const MAX_ARRAY_ITEMS = 64
const MAX_JSON_DEPTH = 10
const MAX_JSON_NODES = 2_000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function safeStableStringify(value: unknown): string | null {
  let nodes = 0
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error('JSON limit exceeded')
    if (typeof current === 'string') {
      if (current.length > MAX_TEXT_LENGTH) throw new Error('String limit exceeded')
      return current
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      return current
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_ARRAY_ITEMS || seen.has(current)) throw new Error('Array limit exceeded')
      seen.add(current)
      const result = current.map(item => visit(item, depth + 1))
      seen.delete(current)
      return result
    }
    if (!isRecord(current) || seen.has(current)) throw new Error('Object limit exceeded')
    const keys = Object.keys(current).sort()
    if (keys.length > MAX_OBJECT_KEYS) throw new Error('Object key limit exceeded')
    seen.add(current)
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      if (key.length > 256) throw new Error('Key limit exceeded')
      result[key] = visit(current[key], depth + 1)
    }
    seen.delete(current)
    return result
  }

  try {
    const serialized = JSON.stringify(visit(value, 0))
    return typeof serialized === 'string' && serialized.length <= MAX_FINGERPRINT_LENGTH ? serialized : null
  } catch {
    return null
  }
}
