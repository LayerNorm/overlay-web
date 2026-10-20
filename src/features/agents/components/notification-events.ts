export function notifyActionError(
  announce: (message: string) => unknown,
  error: unknown,
  fallback: string,
) {
  announce(error instanceof Error ? error.message : fallback)
}

export function consumeOneShotNotification(
  key: string | null,
  handled: { current: string | null },
) {
  if (!key || handled.current === key) return false
  handled.current = key
  return true
}
