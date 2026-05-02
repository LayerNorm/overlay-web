/**
 * Compact strip that surfaces local-browser tool activity for the current
 * conversation. Acts as the unified "tool action card" lane for Phase 3:
 * every local-tool call (page.click, tabs.open, browser_run_task, …) gets a
 * single-line row with status colour and a short detail.
 *
 * Keeping this outside the shared MessageList (which is synced from landing)
 * avoids drift while still giving browser-exclusive tools dedicated UI real
 * estate. The rows are read-only; interactions (retry, pin) can be added in
 * Phase 6 without changing the card contract.
 */
import { AlertTriangle, Check, CircleDashed, Hourglass, MousePointerClick, ShieldAlert, X } from 'lucide-react'
import type { ToolHistoryEntry, LocalToolName } from '@overlay/extension-contracts'

const TOOL_LABELS: Partial<Record<LocalToolName, string>> = {
  'page.click': 'Click',
  'page.click_at': 'Click (coords)',
  'page.type': 'Type',
  'page.press': 'Key press',
  'page.select': 'Select option',
  'page.scroll': 'Scroll',
  'page.find': 'Find on page',
  'page.inspect': 'Inspect page',
  'page.screenshot': 'Screenshot',
  'page.hover': 'Hover',
  'page.drag': 'Drag',
  'page.move_mouse': 'Move cursor',
  'page.wait_for': 'Wait for',
  'tabs.list': 'List tabs',
  'tabs.open': 'Open tab',
  'tabs.focus': 'Focus tab',
  'tabs.close': 'Close tab',
  'tabs.navigate': 'Navigate',
  'tabs.reload': 'Reload',
  'windows.list': 'List windows',
  'windows.focus': 'Focus window',
  'browser_run_task': 'Agentic task',
}

const STATUS_STYLE: Record<ToolHistoryEntry['status'], { Icon: typeof Check; tone: string }> = {
  planned: { Icon: Hourglass, tone: 'text-[var(--muted)]' },
  approved: { Icon: CircleDashed, tone: 'text-[var(--muted)]' },
  completed: { Icon: Check, tone: 'text-[var(--foreground)]' },
  rejected: { Icon: X, tone: 'text-[var(--chat-alert-warning-text,var(--muted))]' },
  failed: { Icon: AlertTriangle, tone: 'text-[var(--chat-alert-error-text,var(--muted))]' },
}

interface LocalToolActivityProps {
  entries: ToolHistoryEntry[]
  conversationId: string | null
  /** Max rows to render. Keeps the strip from dominating the panel. */
  limit?: number
  /** When true, omit top border (e.g. nested in overflow menu). */
  embedded?: boolean
}

export function LocalToolActivity({
  entries,
  conversationId,
  limit = 4,
  embedded = false,
}: LocalToolActivityProps) {
  if (!conversationId) return null
  const scoped = entries
    .filter((e) => e.conversationId === conversationId)
    .slice(0, limit)
  if (scoped.length === 0) return null

  return (
    <ul
      aria-label="Recent browser actions"
      className={
        embedded
          ? 'flex flex-col gap-1 px-1 py-1'
          : 'flex flex-col gap-1 border-t border-[var(--border)] px-3 py-2'
      }
    >
      {scoped.map((entry) => {
        const style = STATUS_STYLE[entry.status] ?? STATUS_STYLE.planned
        const StatusIcon = style.Icon
        const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
        return (
          <li
            key={entry.id}
            className="flex items-start gap-2 rounded-md bg-[var(--surface-subtle)]/40 px-2 py-1.5 text-[11px]"
          >
            <span className={`mt-0.5 inline-flex shrink-0 ${style.tone}`}>
              {entry.status === 'planned' ? (
                <MousePointerClick size={12} strokeWidth={1.75} />
              ) : entry.status === 'approved' ? (
                <ShieldAlert size={12} strokeWidth={1.75} />
              ) : (
                <StatusIcon size={12} strokeWidth={1.75} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[var(--foreground)]">{label}</span>
              <span className="ml-1 text-[var(--muted)]">· {entry.summary}</span>
              {entry.detail ? (
                <span className="mt-0.5 block truncate text-[10.5px] text-[var(--muted)]">
                  {entry.detail}
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
