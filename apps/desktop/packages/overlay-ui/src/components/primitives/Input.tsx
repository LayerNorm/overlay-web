import type { InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-background,var(--surface-elevated))] px-3 text-sm text-[var(--input-text,var(--foreground))] outline-none placeholder:text-[var(--input-placeholder,var(--muted-light))] focus:ring-1 focus:ring-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
