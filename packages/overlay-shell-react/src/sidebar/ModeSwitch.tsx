'use client'

import { Building2, User, type LucideIcon } from 'lucide-react'
import { cn } from '@overlay/ui'
import { Button } from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import type { PanelScope } from '../types'

/** Workspace first: it is the default mode. A building and a person, so the two never look alike. */
export const MODE_OPTIONS: ReadonlyArray<{ id: PanelScope; label: string; icon: LucideIcon }> = [
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'personal', label: 'Personal', icon: User },
]

/**
 * The one Workspace | Personal switch, at the bottom of the primary rail just above the account button. It changes
 * every section at once, so the contextual panels have no scope toggle of their own.
 */
export function RailModeSwitch({ scope, onChange }: { scope: PanelScope; onChange: (scope: PanelScope) => void }) {
  return (
    <div role="radiogroup" aria-label="Mode" className="mb-1.5 flex w-10 shrink-0 flex-col gap-0.5 rounded-xl border border-(--border) p-0.5">
      {MODE_OPTIONS.map(({ id, label, icon: Icon }) => {
        const active = scope === id
        return (
          <DelayedTooltip key={id} label={label} side="right">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              onClick={() => { if (!active) onChange(id) }}
              className={cn(
                'size-[34px] rounded-[9px]',
                active
                  ? 'bg-(--surface-subtle) text-(--foreground) hover:bg-(--surface-subtle)'
                  : 'text-(--muted-light) hover:text-(--foreground)',
              )}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
            </Button>
          </DelayedTooltip>
        )
      })}
    </div>
  )
}
