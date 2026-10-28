export type TitleAttemptOutcome = { title: string | null; failed: boolean }

type TitleAttemptOptions = {
  maxAttempts: number
  budgetMs: number
  signal?: AbortSignal
  now?: () => number
  onError?: (error: unknown) => void
}

export async function runTitleAttempts(
  attempt: (signal: AbortSignal) => Promise<string | null>,
  { maxAttempts, budgetMs, signal, now = Date.now, onError }: TitleAttemptOptions,
): Promise<TitleAttemptOutcome> {
  const start = now()
  const deadline = new AbortController()
  const abortSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(new DOMException('Title deadline exceeded', 'TimeoutError')), budgetMs)
  let lastAttemptFailed = false

  try {
    for (let index = 0; index < maxAttempts; index++) {
      if (abortSignal.aborted) return { title: null, failed: true }
      if (now() - start >= budgetMs) break

      try {
        const title = await attempt(abortSignal)
        abortSignal.throwIfAborted()
        lastAttemptFailed = false
        if (title !== null) return { title, failed: false }
      } catch (error) {
        lastAttemptFailed = true
        if (abortSignal.aborted) break
        onError?.(error)
      }
    }

    return { title: null, failed: lastAttemptFailed }
  } finally {
    clearTimeout(timer)
  }
}
