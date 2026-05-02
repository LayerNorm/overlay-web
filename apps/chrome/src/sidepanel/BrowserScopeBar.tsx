/**
 * Compact pill-segment selector for the browser scope of a conversation.
 *
 *   Active tab      → only the tab currently behind the side panel (default)
 *   Current window  → all tabs in the focused window
 *   All windows     → every open window (destructive; confirmation lives in
 *                     Phase 6's security gates, surfaced here as a warning
 *                     below the segment)
 *
 * The selection is persisted per-conversation via
 * `overlay.runtime.conversation.settings.save` so that the next Ask defaults
 * to the same scope without the user re-picking.
 */
import { Globe, LayoutGrid, MousePointerClick } from 'lucide-react'
import type { BrowserScopeMode } from '@overlay/extension-contracts'

const SCOPE_OPTIONS: Array<{
  id: BrowserScopeMode
  label: string
  Icon: typeof Globe
  hint: string
}> = [
  { id: 'active-tab', label: 'Tab', Icon: MousePointerClick, hint: 'Active tab only' },
  { id: 'current-window', label: 'Window', Icon: LayoutGrid, hint: 'All tabs in this window' },
  { id: 'all-windows', label: 'All', Icon: Globe, hint: 'Every open window' },
]

interface BrowserScopeBarProps {
  value: BrowserScopeMode
  onChange: (next: BrowserScopeMode) => void
  disabled?: boolean
  windowTabCount?: number
}

export function BrowserScopeBar({
  value,
  onChange,
  disabled,
  windowTabCount,
}: BrowserScopeBarProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Browser scope"
        className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5"
      >
        {SCOPE_OPTIONS.map(({ id, label, Icon, hint }) => {
          const isActive = id === value
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              title={hint}
              onClick={() => onChange(id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                isActive
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Icon size={12} strokeWidth={1.75} />
              {label}
              {id === 'current-window' && typeof windowTabCount === 'number' && isActive ? (
                <span className="ml-0.5 rounded-full bg-[var(--surface-subtle)]/30 px-1 text-[10px] tabular-nums">
                  {windowTabCount}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {value === 'all-windows' ? (
        <p className="text-[10px] leading-tight text-[var(--chat-alert-warning-text,var(--muted))]">
          Overlay will see tabs from every open Chrome window. Only use on
          trusted sessions.
        </p>
      ) : null}
    </div>
  )
}
