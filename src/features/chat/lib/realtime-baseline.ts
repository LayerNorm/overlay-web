// Opt-in, local-only User Timing marks. Never include content or resource IDs.
// Marks are only written when the QA harness sets `overlay:baseline:enabled`
// (scripts/qa/realtime-baseline.mjs and scripts/qa/perf-baseline.mjs), so they
// cost one `getEntriesByName` lookup in normal sessions.
function baselineEnabled(): boolean {
  return typeof window !== 'undefined'
    && performance.getEntriesByName('overlay:baseline:enabled').length > 0
}

function markBaseline(name: string): void {
  if (!baselineEnabled()) return
  performance.clearMarks(name)
  performance.mark(name)
}

export function markPersonalChatQueryReady() {
  markBaseline('overlay:baseline:personal-query-ready')
  // The transcript data is ready; mark the frame after it is committed and painted.
  if (!baselineEnabled()) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => markBaseline('overlay:baseline:transcript-painted'))
  })
}

/** The chat composer is mounted and accepts input. */
export function markComposerReady() {
  markBaseline('overlay:baseline:composer-ready')
}
