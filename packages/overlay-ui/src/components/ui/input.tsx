import * as React from 'react'

import { cn } from '../../utils/cn'

export type InputProps = React.ComponentProps<'input'>

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-lg border border-(--border) bg-(--input-background,var(--surface-elevated)) px-3 text-sm text-(--input-text,var(--foreground)) outline-hidden placeholder:text-(--input-placeholder,var(--muted-light)) focus:ring-1 focus:ring-(--foreground) disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
