import type { HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'success' | 'warning' | 'danger'
}

const variantClasses = {
  default: 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]',
  muted: 'border-[var(--border)] bg-transparent text-[var(--muted)]',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-600',
} as const

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}
