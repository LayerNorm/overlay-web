/**
 * Minimal surface that summarises the tab-group context of the current Act
 * scope. The full rename/ungroup UX is out of scope for Phase 3; this badge
 * acknowledges the group so users understand why Overlay is seeing multiple
 * tabs and gives them a way to click through to Chrome's native tab-group
 * management.
 *
 * Phase 3 renders a read-only pill. Phase 6 will replace the onClick with a
 * popover exposing rename / ungroup actions wired to `chrome.tabGroups`.
 */
import { Layers } from 'lucide-react'
import type { BrowserScopeMode, WindowTabSnapshot } from '@overlay/extension-contracts'

interface TabGroupBadgeProps {
  scope: BrowserScopeMode
  windowTabs: WindowTabSnapshot[]
}

export function TabGroupBadge({ scope, windowTabs }: TabGroupBadgeProps) {
  if (scope === 'active-tab') return null
  const count =
    scope === 'current-window'
      ? windowTabs.length
      : // all-windows count is only approximate here (we only have the current
        // window's tabs in the side-panel bootstrap). Render a generic badge.
        undefined

  const label =
    scope === 'current-window'
      ? `Window · ${count ?? '…'} tab${count === 1 ? '' : 's'}`
      : 'All windows'

  return (
    <span
      title="Overlay will see these tabs as a group during Act runs"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
    >
      <Layers size={10} strokeWidth={1.75} />
      {label}
    </span>
  )
}
