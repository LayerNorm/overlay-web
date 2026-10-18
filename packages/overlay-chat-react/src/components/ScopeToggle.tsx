import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import type { BrowserScope } from '@overlay/chat-core'

interface ScopeToggleProps {
  scope: BrowserScope
  onChange: (scope: BrowserScope) => void
}

const OPTIONS: { value: BrowserScope; label: string }[] = [
  { value: 'active-tab', label: 'Active tab' },
  { value: 'current-window', label: 'Current window' },
]

export function ScopeToggle({ scope, onChange }: ScopeToggleProps) {
  return (
    <div className="flex min-w-0 items-center rounded-lg bg-(--surface-subtle) p-0.5">
      {OPTIONS.map((item) => {
        const active = item.value === scope
        return (
          <Button variant="ghost"
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={unstyledButton(`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[11px] transition-colors sm:px-2.5 sm:text-xs ${
              active
                ? 'bg-(--surface-elevated) font-medium text-(--foreground) shadow-xs'
                : 'text-(--muted) hover:text-(--foreground)'
            }`)}
          >
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}
