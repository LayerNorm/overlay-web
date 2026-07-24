import type { HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4',
        className,
      )}
      {...props}
    />
  )
}
