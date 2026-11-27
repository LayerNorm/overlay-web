/**
 * Upward-opening dropdown that sits just above the composer and lets the user
 * choose how destructive browser actions are gated during Act runs:
 *
 *   "Ask before acting" (default) — every write-class tool call surfaces an
 *     ApprovalCard. Safe; recommended for unfamiliar pages.
 *   "Act without asking" — destructive tools run as soon as the model plans
 *     them. A persistent warning strip is shown below the composer explaining
 *     that Overlay can make mistakes.
 *
 * The menu is controlled by its parent (App.tsx) so the warning strip can
 * render outside the menu's DOM scope.
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronUp, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ActApprovalMode } from '@overlay/extension-contracts'

interface ActApprovalModeMenuProps {
  value: ActApprovalMode
  onChange: (next: ActApprovalMode) => void
  disabled?: boolean
}

const OPTIONS: Array<{
  id: ActApprovalMode
  label: string
  description: string
  Icon: typeof ShieldCheck
}> = [
  {
    id: 'ask',
    label: 'Ask before acting',
    description: 'Approve every write-class action before Overlay runs it.',
    Icon: ShieldCheck,
  },
  {
    id: 'auto',
    label: 'Act without asking',
    description: 'Run destructive actions immediately. Double-check responses.',
    Icon: ShieldAlert,
  },
]

export function ActApprovalModeMenu({ value, onChange, disabled }: ActApprovalModeMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = OPTIONS.find((o) => o.id === value) ?? OPTIONS[0]
  const ActiveIcon = active.Icon

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ActiveIcon size={12} strokeWidth={1.75} />
        <span className="truncate">{active.label}</span>
        <ChevronUp size={12} strokeWidth={1.75} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-[260px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-lg"
          >
            {OPTIONS.map((opt) => {
              const Icon = opt.Icon
              const isActive = opt.id === value
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onChange(opt.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[12px] transition-colors ${
                      isActive
                        ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <Icon size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-[var(--foreground)]">{opt.label}</span>
                        {isActive ? <Check size={12} strokeWidth={2} /> : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-[var(--muted)]">
                        {opt.description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/**
 * Persistent strip shown below the composer when auto-mode is active.
 * Separated from the menu so it renders outside the menu's closed state.
 */
export function ActAutonomousWarning() {
  return (
    <p
      role="note"
      className="border-t border-[var(--chat-alert-warning-border,var(--border))] bg-[var(--chat-alert-warning-bg,var(--surface-subtle))] px-4 py-1.5 text-[11px] text-[var(--chat-alert-warning-text,var(--muted))]"
    >
      Act-without-asking is on. Overlay can make mistakes — please double-check responses.
    </p>
  )
}
