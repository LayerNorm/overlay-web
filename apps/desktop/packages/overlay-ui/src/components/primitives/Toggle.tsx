import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Toggle({
  checked,
  onCheckedChange,
  disabled,
  className,
  type = 'button',
  ...props
}: ToggleProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange?.(!checked)
      }}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-70',
        checked
          ? 'border-[var(--foreground)] bg-[var(--foreground)]'
          : 'border-[var(--border)] bg-[var(--surface-subtle)]',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-[var(--surface-elevated)] transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}
