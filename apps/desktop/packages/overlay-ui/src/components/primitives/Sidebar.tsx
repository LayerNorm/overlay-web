import type { HTMLAttributes, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../utils/cn'

export function SidebarShell({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar-surface)]',
        className,
      )}
      {...props}
    />
  )
}

export function SidebarSection({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-t border-[var(--border)] px-2 py-3', className)} {...props} />
}

export function SidebarNav({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <nav className={cn('space-y-0.5 px-2 py-3', className)} {...props} />
}

export interface SidebarResourceAction {
  label: string
  onClick: () => void
}

export interface SidebarResourceSearch {
  title: string
  onClick: () => void
}

export function SidebarResourceSection({
  action,
  search,
  children,
}: {
  action?: SidebarResourceAction | null
  search?: SidebarResourceSearch | null
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] px-2 py-3">
      {action && search ? (
        <div className="mb-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={action.onClick}
            className="flex flex-1 items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <span className="min-w-0 flex-1 text-left text-xs">{action.label}</span>
          </button>
          <button
            type="button"
            title={search.title}
            onClick={search.onClick}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <Search size={13} strokeWidth={1.75} />
          </button>
        </div>
      ) : action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mb-3 flex w-full items-center gap-2.5 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <span className="min-w-0 flex-1 text-left">{action.label}</span>
        </button>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export function SidebarResourceList({ children }: { children: ReactNode }) {
  return <div className="space-y-0.5">{children}</div>
}
