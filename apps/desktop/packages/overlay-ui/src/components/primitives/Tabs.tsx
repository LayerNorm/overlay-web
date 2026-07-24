import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex rounded-lg bg-[var(--surface-subtle)] p-0.5', className)}
      {...props}
    />
  )
}

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function TabButton({
  active,
  type = 'button',
  className,
  ...props
}: TabButtonProps) {
  return (
    <button
      type={type}
      role="tab"
      aria-selected={active}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-[var(--surface-elevated)] font-medium text-[var(--foreground)] shadow-sm'
          : 'text-[var(--muted)] hover:text-[var(--foreground)]',
        className,
      )}
      {...props}
    />
  )
}
