// Opt-in, local-only User Timing marks. Never include content or resource IDs.
export function markPersonalChatQueryReady() {
  if (typeof window === 'undefined') return
  if (!performance.getEntriesByName('overlay:baseline:enabled').length) return
  performance.clearMarks('overlay:baseline:personal-query-ready')
  performance.mark('overlay:baseline:personal-query-ready')
}
