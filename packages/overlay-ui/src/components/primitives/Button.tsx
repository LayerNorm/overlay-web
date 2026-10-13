import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-(--foreground) text-(--background) hover:opacity-90 disabled:opacity-50',
  secondary:
    'border border-(--border) bg-(--surface-subtle) text-(--foreground) hover:bg-(--border) disabled:opacity-50',
  ghost:
    'bg-transparent text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50',
  danger:
    'bg-red-500 text-white hover:opacity-90 disabled:opacity-50',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-md px-3 text-xs',
  md: 'h-9 rounded-lg px-4 text-sm',
  lg: 'h-10 rounded-xl px-5 text-sm',
  icon: 'h-9 w-9 rounded-lg p-0',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  )
}
