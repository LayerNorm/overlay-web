export function installKeystrokeObserver(editor) {
  window.__perfKeyLatency = []
  window.__perfKeyDiagnostics = { inputs: 0, frames: 0, coalesced: 0, rejected: 0 }
  let start = null
  editor.addEventListener('keydown', event => {
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) start = event.timeStamp
  })
  editor.addEventListener('input', () => {
    if (start === null) return
    window.__perfKeyDiagnostics.inputs += 1
    const startedAt = start
    start = null
    const value = editor.textContent ?? ''
    requestAnimationFrame(() => setTimeout(() => {
      const diagnostic = window.__perfKeyDiagnostics
      diagnostic.frames += 1
      const current = editor.textContent ?? ''
      // Later keystrokes may share this frame; the earlier prefix is still visible.
      if (!editor.isConnected || !value || !current.startsWith(value)
          || !document.querySelector('[data-text-streaming="true"]')) {
        diagnostic.rejected += 1
        return
      }
      if (current !== value) diagnostic.coalesced += 1
      window.__perfKeyLatency.push(performance.now() - startedAt)
    }, 0))
  })
}

// Pure helpers for scripts/qa/perf-baseline.mjs. Kept free of Playwright so they
// can be unit tested (perf-baseline-lib.test.mjs).

export const SCENARIOS = ['cold-start', 'thread-switch', 'typing-while-streaming', 'dm-scroll']

// Chrome DevTools "Fast 4G" preset plus 4x CPU slowdown (docs: UI snappiness plan, section 2).
export const THROTTLE_PROFILES = {
  none: null,
  'fast-4g-cpu4x': {
    cpuRate: 4,
    network: { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  },
}

// Targets from the plan. Lab-only; field INP/LCP come from Speed Insights.
export const TARGETS = {
  'thread-switch.contentVisible.warm': 100,
  'thread-switch.contentVisible.cold': 500,
  'typing-while-streaming.keystrokeP75': 50,
}

/**
 * Accepts a canonical PR Preview origin (same rule as realtime-baseline) or a
 * local production server on loopback. Anything else is rejected so the suite
 * never drives a signed-in browser against production or a third-party host.
 */
export function perfOrigin(value) {
  const url = new URL(value)
  const clean = !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
  const preview = url.protocol === 'https:' && !url.port && /^pr-[1-9][0-9]*\.preview\.getoverlay\.io$/.test(url.hostname)
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (!clean || !(preview || loopback)) {
    throw new Error('Use a PR Preview origin or a local production server (http://localhost:PORT)')
  }
  return url.origin
}

export function appPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\r\n\t]/.test(value)) throw new Error('A relative app path is required')
  return value
}

export function fixtureBackendUrl(origin, backend) {
  if (!perfOrigin(origin).startsWith('https://') || !/^[a-z]+-[a-z]+-[0-9]+$/.test(backend ?? '')) {
    throw new Error('A verified isolated Preview backend is required')
  }
  return `https://${backend}.convex.cloud`
}

export function positiveInteger(value, fallback, max = 100) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error('Invalid numeric configuration')
  return parsed
}

export function requireObservedInteraction(sample) {
  const requiredStages = ['localFeedback', 'contentVisible']
  if (sample?.action !== 'completed' || requiredStages.some(name => {
    const stage = sample.stages?.[name]
    return stage?.status !== 'observed' || !Number.isFinite(stage.ms) || stage.ms < 0
  })) {
    throw new Error('Interaction did not produce all required observations')
  }
  return sample
}

export function parseScenarios(value) {
  if (value === undefined) return [...SCENARIOS]
  const selected = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (!selected.length) throw new Error('At least one scenario is required')
  const unknown = selected.filter((item) => !SCENARIOS.includes(item))
  if (unknown.length) throw new Error(`Unknown scenario(s): ${unknown.join(', ')}`)
  return selected
}

/** Nearest-rank percentile; returns null for an empty sample. */
export function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return round(sorted[rank - 1])
}

export function summarize(values) {
  const finite = values.filter((value) => Number.isFinite(value))
  return {
    n: finite.length,
    median: percentile(finite, 50),
    p75: percentile(finite, 75),
    max: finite.length ? round(Math.max(...finite)) : null,
  }
}

export function round(value) {
  return Math.round(value * 100) / 100
}

/** Difference between two perf-debug render snapshots (after - before). */
export function renderDelta(before = {}, after = {}) {
  const delta = {}
  for (const [name, count] of Object.entries(after)) {
    const diff = count - (before[name] ?? 0)
    if (diff > 0) delta[name] = diff
  }
  return Object.fromEntries(Object.entries(delta).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Turns render counts collected while a reply streamed into the numbers the
 * Phase 3 guard will assert on. `updates` is the number of transcript commits
 * observed (streaming ChatExchange renders), used as the per-update denominator.
 */
export function streamingRenderReport(renders) {
  const updates = renders['ChatExchange(streaming)'] ?? 0
  const perUpdate = (name) => (updates ? round((renders[name] ?? 0) / updates) : null)
  return {
    streamingUpdates: updates,
    settledExchangeRenders: renders.ChatExchange ?? 0,
    settledExchangeRendersPerUpdate: perUpdate('ChatExchange'),
    composerRendersPerUpdate: perUpdate('ChatComposer'),
    sidebarRendersPerUpdate: perUpdate('AppSidebar'),
    transcriptRendersPerUpdate: perUpdate('ChatTranscript'),
  }
}

/** Frame-time stats from rAF timestamps captured during a scroll. */
export function frameReport(timestamps) {
  const gaps = []
  for (let i = 1; i < timestamps.length; i += 1) gaps.push(timestamps[i] - timestamps[i - 1])
  const durationMs = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0
  return {
    frames: timestamps.length,
    fps: durationMs > 0 ? round(((timestamps.length - 1) * 1000) / durationMs) : null,
    frameP75: percentile(gaps, 75),
    frameMax: gaps.length ? round(Math.max(...gaps)) : null,
    // A frame over ~2x a 60 Hz budget is a visible hitch.
    hitchIntervals: gaps.filter((gap) => gap > 34).length,
  }
}

export function markdownReport(result) {
  const lines = [
    `# UI perf baseline`,
    '',
    `- Revision: \`${result.revision ?? 'unknown'}\``,
    `- Expected target revision (verify separately): \`${result.targetRevision ?? 'unknown'}\``,
    `- Origin kind: ${result.originKind}`,
    `- Throttle: ${result.throttle}`,
    `- Runs per scenario: ${result.runs}`,
    `- Captured: ${result.capturedAt}`,
    '',
    '| Scenario | Metric | n | median | p75 | max |',
    '|---|---|---|---|---|---|',
  ]
  for (const [scenario, data] of Object.entries(result.scenarios)) {
    if (data.error) {
      lines.push(`| ${scenario} | error: ${data.error} | | | | |`)
      if (data.lastStage) lines.push(`| ${scenario} | Last stage: ${data.lastStage}; run: ${data.sampleRun} | | | | |`)
      continue
    }
    for (const [metric, stats] of Object.entries(data.metrics ?? {})) {
      lines.push(`| ${scenario} | ${metric} | ${stats.n} | ${stats.median ?? '-'} | ${stats.p75 ?? '-'} | ${stats.max ?? '-'} |`)
    }
  }
  const renderSections = Object.entries(result.scenarios).filter(([, data]) => data.renders)
  for (const [scenario, data] of Object.entries(result.scenarios)) {
    if (data.workload) lines.push('', `- ${scenario} workload: ${data.workload}`)
  }
  if (renderSections.length) {
    lines.push('', '## Render counts', '')
    for (const [scenario, data] of renderSections) {
      lines.push(`### ${scenario}`, '', '```json', JSON.stringify(data.renders, null, 2), '```', '')
    }
  }
  return `${lines.join('\n')}\n`
}
