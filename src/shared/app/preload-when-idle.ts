/**
 * Starts a code-split import once the browser is idle, so the chunk is usually
 * ready before its first use without competing with startup work.
 */
export function preloadWhenIdle(load: () => Promise<unknown>): void {
  if (typeof window === 'undefined') return
  const run = () => void load().catch(() => {})
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 })
  else window.setTimeout(run, 0)
}
