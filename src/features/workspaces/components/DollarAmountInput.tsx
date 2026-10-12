'use client'

import { useState } from 'react'
import { Input } from '@overlay/ui/primitives'

/**
 * Any whole-dollar amount in a range (plans and top-ups are $8 to $500). Typing is free; the value settles within
 * the range when the field loses focus. Reports cents.
 */
export function DollarAmountInput({
  valueCents,
  minCents,
  maxCents,
  suffix,
  label,
  onChange,
}: {
  valueCents: number
  minCents: number
  maxCents: number
  suffix?: string
  label: string
  onChange: (cents: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const clamp = (dollars: number) => Math.min(maxCents, Math.max(minCents, dollars * 100))
  return (
    <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-sm text-[var(--muted)]">
      $
      <Input
        aria-label={label}
        inputMode="numeric"
        className="h-8 !w-16 flex-none tabular-nums"
        value={text ?? String(valueCents / 100)}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d]/g, '').slice(0, 5)
          setText(raw)
          const dollars = parseInt(raw, 10)
          if (Number.isFinite(dollars) && dollars * 100 >= minCents && dollars * 100 <= maxCents) onChange(dollars * 100)
        }}
        onBlur={() => {
          const dollars = parseInt(text ?? '', 10)
          if (Number.isFinite(dollars)) onChange(clamp(dollars))
          setText(null)
        }}
      />
      {suffix ? <span>{suffix}</span> : null}
    </span>
  )
}
