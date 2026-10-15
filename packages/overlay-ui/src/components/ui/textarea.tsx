import * as React from 'react'

import { cn } from '../../utils/cn'

export type TextareaProps = React.ComponentProps<'textarea'>

function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full resize-y rounded-lg border border-(--border) bg-(--input-background,var(--surface-elevated)) px-3 py-2 text-sm leading-6 text-(--input-text,var(--foreground)) outline-hidden placeholder:text-(--input-placeholder,var(--muted-light)) focus:ring-1 focus:ring-(--foreground) disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
