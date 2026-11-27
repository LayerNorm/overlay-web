'use client'

import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { cn } from '@overlay/ui'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'

export type SearchScope = 'all' | 'personal' | 'workspace'

const OPTIONS: Array<{ id: SearchScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'personal', label: 'Personal' },
  { id: 'workspace', label: 'Workspace' },
]

/**
 * All | Personal | Workspace at the right of global search's input, in the sidebar's Workspace | Personal switch
 * style. A workspace with one person has nothing to tell apart, so it shows no filter (as `ScopeTag` shows no tag).
 */
export function SearchScopeFilter({ value, onChange }: { value: SearchScope; onChange: (value: SearchScope) => void }) {
  if (useIsSoloWorkspace()) return null
  return (
    <div role="radiogroup" aria-label="Show" className="inline-flex shrink-0 gap-0.5 rounded-lg bg-(--surface-subtle) p-0.5">
      {OPTIONS.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          type="button"
          role="radio"
          aria-checked={value === option.id}
          // Keep focus in the search input so typing and arrow keys keep working.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.id)}
          className={unstyledButton(cn(
            'h-6 rounded-md px-2.5 text-[11px] font-medium transition-colors',
            value === option.id
              ? 'bg-(--surface-elevated) text-(--foreground) shadow-sm'
              : 'text-(--muted) hover:text-(--foreground)',
          ))}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
