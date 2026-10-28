export type TitleAttemptOutcome = { title: string | null; failed: boolean }

type TitleAttemptOptions = {
  maxAttempts: number
  budgetMs: number
  now?: () => number
  onError?: (error: unknown) => void
}

export async function runTitleAttempts(
  attempt: () => Promise<string | null>,
  { maxAttempts, budgetMs, now = Date.now, onError }: TitleAttemptOptions,
): Promise<TitleAttemptOutcome> {
  const start = now()
  let lastAttemptFailed = false

  for (let index = 0; index < maxAttempts; index++) {
    if (now() - start >= budgetMs) break

    try {
      const title = await attempt()
      lastAttemptFailed = false
      if (title !== null) return { title, failed: false }
    } catch (error) {
      lastAttemptFailed = true
      onError?.(error)
    }
  }

  return { title: null, failed: lastAttemptFailed }
}
