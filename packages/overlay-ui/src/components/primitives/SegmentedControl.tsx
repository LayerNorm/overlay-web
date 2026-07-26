'use client'

import React from 'react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../../utils/cn'

export type SegmentedControlOption<T extends string> = {
  value: T
  label: ReactNode
  icon?: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
  compactLabels?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  compactLabels = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex h-8 shrink-0 items-center rounded-lg bg-[var(--surface-subtle)] p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value
        const Icon = option.icon
        const optionDisabled = disabled || option.disabled
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={optionDisabled}
            onClick={() => {
              if (!optionDisabled) onChange(option.value)
            }}
            className={cn(
              'inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              active
                ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              optionDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            {Icon ? <Icon size={12} strokeWidth={1.75} className="shrink-0" /> : null}
            <span className={compactLabels ? 'hidden sm:inline' : undefined}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
