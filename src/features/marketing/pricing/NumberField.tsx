'use client'
import { Input } from '@overlay/ui/primitives'
import { unstyledInput } from '../control-reset'
import { useState } from 'react'
import s from './pricing.module.css'

/**
 * A dollar field that lets you type freely and only settles on a valid number
 * (at least `min`) when you leave it. Valid numbers are reported as you type.
 */
export function NumberField({
  value,
  min,
  max = Number.MAX_SAFE_INTEGER,
  onChange,
  label,
  small = false,
}: {
  value: number
  min: number
  max?: number
  onChange: (value: number) => void
  label: string
  small?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <label className={small ? `${s.money} ${s.sm}` : s.money}>
      $
      <Input
        inputMode="numeric"
        aria-label={label}
        value={text ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 6)
          setText(raw)
          const n = parseInt(raw, 10)
          if (Number.isFinite(n) && n >= min) onChange(Math.min(n, max))
        }}
        onBlur={() => {
          const n = parseInt(text ?? '', 10)
          if (Number.isFinite(n) && n < min) onChange(min)
          else if (Number.isFinite(n) && n > max) onChange(max)
          setText(null)
        }}
       className={unstyledInput()}/>
    </label>
  )
}
