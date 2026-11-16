/**
 * Shared tooltip warm-up. The first tooltip waits {@link TOOLTIP_OPEN_DELAY_MS};
 * while one is open, or shortly after one closes, the next opens instantly and
 * without an entrance animation, so moving along a toolbar never waits again.
 * Both Radix tooltips (`DelayedTooltip`) and the global `title` tooltips use it.
 */
export const TOOLTIP_OPEN_DELAY_MS = 300
const TOOLTIP_SKIP_DELAY_MS = 500

let openCount = 0
let lastClosedAt = Number.NEGATIVE_INFINITY

export function isTooltipWarm(): boolean {
  return openCount > 0 || performance.now() - lastClosedAt < TOOLTIP_SKIP_DELAY_MS
}

export function markTooltipOpened(): void {
  openCount += 1
}

export function markTooltipClosed(): void {
  openCount = Math.max(0, openCount - 1)
  lastClosedAt = performance.now()
}
