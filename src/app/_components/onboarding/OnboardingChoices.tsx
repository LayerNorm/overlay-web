'use client'

import { Check } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'

const chip = 'h-8 rounded-full px-3.5 text-[13px] font-normal text-(--foreground) aria-pressed:border-(--muted-light) aria-pressed:bg-(--surface-subtle)'

/** One tap answers the question. */
export function SingleChoices({ choices, disabled, onPick }: { choices: readonly string[]; disabled: boolean; onPick(label: string): void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((label) => (
        <Button key={label} variant="outline" className={chip} disabled={disabled} onClick={() => onPick(label)}>{label}</Button>
      ))}
    </div>
  )
}

/** Toggles a set of answers. Selection lives here, never in the composer text. */
export function MultiChoices({ choices, selected, disabled, onToggle, onContinue }: {
  choices: readonly string[]
  selected: ReadonlySet<string>
  disabled: boolean
  onToggle(label: string): void
  onContinue(): void
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {choices.map((label) => (
          <Button key={label} variant="outline" className={chip} aria-pressed={selected.has(label)} disabled={disabled} onClick={() => onToggle(label)}>
            {label}{selected.has(label) ? <Check className="size-3.5" aria-hidden /> : null}
          </Button>
        ))}
      </div>
      <Button variant="primary" size="sm" className="mt-3.5" disabled={disabled || selected.size === 0} onClick={onContinue}>Continue</Button>
    </div>
  )
}
