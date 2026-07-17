/**
 * Lightweight, opt-in performance instrumentation for the chat rendering path.
 *
 * Enable in the browser console with:
 *   localStorage.setItem('overlay_perf', '1'); location.reload()
 * or append `?perf=1` to the URL. Disable with:
 *   localStorage.removeItem('overlay_perf')
 *
 * When enabled it:
 *   - counts renders per component and prints a 1s rollup (spot re-render loops),
 *   - times synchronous hot paths (markdown normalize/parse) and warns on slow ones.
 *
 * Long-task logging is intentionally separate because console.warn + rrweb console
 * recording can add significant overhead in dev. Enable it with:
 *   localStorage.setItem('overlay_perf_longtasks', '1'); location.reload()
 *
 * Everything is a no-op (and tree-shake friendly via the early `enabled` checks)
 * when the flag is off, so it is safe to leave wired in.
 */

let cachedEnabled: boolean | null = null

export function isPerfDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled
  if (typeof window === 'undefined') return false
  try {
    const ls = window.localStorage?.getItem('overlay_perf')
    const qs = new URLSearchParams(window.location.search).get('perf')
    cachedEnabled = ls === '1' || qs === '1' || (window as { __overlayPerf?: boolean }).__overlayPerf === true
  } catch {
    cachedEnabled = false
  }
  if (cachedEnabled) startGlobalReporters()
  return cachedEnabled
}

// ── render counters ──────────────────────────────────────────────────────────
const renderCounts = new Map<string, number>()
const slowTimings = new Map<string, { count: number; totalMs: number; maxMs: number }>()
const totalRenderCounts = new Map<string, number>()
const totalTimings = new Map<string, { count: number; totalMs: number; maxMs: number }>()
let reportersStarted = false

export function recordRender(name: string): void {
  if (!isPerfDebugEnabled()) return
  renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1)
  totalRenderCounts.set(name, (totalRenderCounts.get(name) ?? 0) + 1)
}

/** Time a synchronous function, accumulating stats under `label`. Returns its result. */
export function timeSync<T>(label: string, fn: () => T): T {
  if (!isPerfDebugEnabled()) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    const ms = performance.now() - start
    const cur = slowTimings.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 }
    cur.count += 1
    cur.totalMs += ms
    cur.maxMs = Math.max(cur.maxMs, ms)
    slowTimings.set(label, cur)
    const total = totalTimings.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 }
    total.count += 1
    total.totalMs += ms
    total.maxMs = Math.max(total.maxMs, ms)
    totalTimings.set(label, total)
    if (ms > 30) {
      // eslint-disable-next-line no-console
      console.warn(`[perf] slow ${label}: ${ms.toFixed(1)}ms`)
    }
  }
}
export type PerfDebugSnapshot = {
  renders: Record<string, number>
  timings: Record<string, { count: number; totalMs: number; maxMs: number }>
}

export function getPerfDebugSnapshot(): PerfDebugSnapshot {
  return {
    renders: Object.fromEntries([...totalRenderCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    timings: Object.fromEntries(
      [...totalTimings.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, stats]) => [label, { ...stats }]),
    ),
  }
}

export function resetPerfDebugSnapshot(): void {
  totalRenderCounts.clear()
  totalTimings.clear()
}

function isLongTaskDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem('overlay_perf_longtasks') === '1' ||
      new URLSearchParams(window.location.search).get('perfLongTasks') === '1'
  } catch {
    return false
  }
}

function startGlobalReporters(): void {
  if (reportersStarted || typeof window === 'undefined') return
  reportersStarted = true

  // 1s rollup of render counts + timing stats.
  setInterval(() => {
    if (renderCounts.size === 0 && slowTimings.size === 0) return
    const renders = [...renderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}=${n}`)
      .join('  ')
    const timings = [...slowTimings.entries()]
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .map(([label, s]) => `${label}: n=${s.count} total=${s.totalMs.toFixed(0)}ms max=${s.maxMs.toFixed(1)}ms`)
      .join('  |  ')
    // eslint-disable-next-line no-console
    if (renders) console.log(`[perf] renders/s  ${renders}`)
    // eslint-disable-next-line no-console
    if (timings) console.log(`[perf] timings/s  ${timings}`)
    renderCounts.clear()
    slowTimings.clear()
  }, 1000)

  if (isLongTaskDebugEnabled()) {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) {
            // eslint-disable-next-line no-console
            console.warn(`[perf] LONG TASK ${entry.duration.toFixed(0)}ms`, entry)
          }
        }
      })
      obs.observe({ entryTypes: ['longtask'] })
    } catch {
      /* longtask not supported */
    }
  }
}
