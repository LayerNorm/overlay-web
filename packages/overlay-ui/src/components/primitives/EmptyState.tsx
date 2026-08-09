import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../utils/cn'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-4 text-center text-[var(--muted)]', className)}
      {...props}
    >
      {icon ? <div className="text-[var(--muted-light)]">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        {description ? <p className="text-xs text-[var(--muted-light)]">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
