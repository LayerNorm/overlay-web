/** Only show string errors; a proxy or protection layer may answer with an object. */
export function readAuthErrorMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error
  return typeof error === 'string' && error.trim() ? error : fallback
}
