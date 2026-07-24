import type { TextareaHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input-background,var(--surface-elevated))] px-3 py-2 text-sm leading-6 text-[var(--input-text,var(--foreground))] outline-none placeholder:text-[var(--input-placeholder,var(--muted-light))] focus:ring-1 focus:ring-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
