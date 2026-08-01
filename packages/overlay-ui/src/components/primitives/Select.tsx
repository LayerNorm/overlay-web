import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        // Extra right padding so the native chevron keeps clear space on both
        // sides instead of sitting flush against the border.
        'h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] py-0 pl-3 pr-10 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
