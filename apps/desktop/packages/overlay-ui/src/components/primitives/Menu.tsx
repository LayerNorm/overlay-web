import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export function MenuSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg',
        className,
      )}
      {...props}
    />
  )
}

export function MenuItem({
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:text-[var(--muted-light)]',
        className,
      )}
      {...props}
    />
  )
}
