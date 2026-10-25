export function safeSetLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, value) } catch {}
}

export function normalizeStoredModelId(raw: string, allowedIds: readonly string[]): string | null {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    value = raw
  }
  const candidates = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((candidate): candidate is string => typeof candidate === 'string')
      : []
  return candidates.find((candidate) => allowedIds.includes(candidate)) ?? null
}
