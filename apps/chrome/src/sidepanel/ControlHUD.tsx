/**
 * Side-panel mirror of the content-script "Overlay is driving this tab"
 * indicator. Pulses while an Act run is actively executing a tool so users
 * know the extension has control, even when the affected tab is not the one
 * behind the side panel.
 *
 * The source of truth lives in `controlIndicator` on RuntimeBootstrap; this
 * component is a pure renderer and does not talk to the runtime directly.
 */
import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import type { ControlIndicatorState } from '@overlay/extension-contracts'

interface ControlHUDProps {
  indicator: ControlIndicatorState | null
}

export function ControlHUD({ indicator }: ControlHUDProps) {
  if (!indicator || !indicator.active) return null

  const target = indicator.targetLabel || (indicator.toolName ?? 'browser tool')

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      role="status"
      aria-live="polite"
      className="mx-3 mt-2 flex items-center gap-2 rounded-full border border-[var(--chat-alert-info-border,var(--border))] bg-[var(--chat-alert-info-bg,var(--surface-elevated))] px-3 py-1.5 text-[11px] text-[var(--chat-alert-info-text,var(--foreground))]"
    >
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      <Activity size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">
        <span className="font-medium">{indicator.label || 'Running'}</span>
        <span className="ml-1 text-[var(--muted)]">· {target}</span>
      </span>
    </motion.div>
  )
}
