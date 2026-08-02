import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
