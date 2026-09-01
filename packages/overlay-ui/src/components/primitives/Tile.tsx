import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface TileGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Max columns on xl screens. Renders 1 column on mobile and 2 from sm up. */
  columns?: 1 | 2 | 3 | 4
}

const gridColumnsClasses: Record<Exclude<TileGridProps['columns'], undefined>, string> = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
}

export function TileGrid({ columns = 3, className, ...props }: TileGridProps) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-3', gridColumnsClasses[columns], className)}
      {...props}
    />
  )
}

export interface TileProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Override the rendered element (e.g. next/link). Defaults to a/button/div from href/onClick. */
  as?: ElementType
  href?: string
  onClick?: () => void
  disabled?: boolean
  /** Highlighted state for inline editing or selection. */
  selected?: boolean
  leading?: ReactNode
  title?: ReactNode
  description?: ReactNode
  topRight?: ReactNode
  footer?: ReactNode
}

export function Tile({
  as,
  href,
  onClick,
  disabled,
  selected = false,
  leading,
  title,
  description,
  topRight,
  footer,
  className,
  children,
  ...props
}: TileProps) {
  const interactive = Boolean(href || onClick) && !disabled
  const Component = (as ?? (href ? 'a' : onClick ? 'button' : 'div')) as ElementType
  return (
    <Component
      {...(Component === 'button' && !('type' in props) ? { type: 'button' } : null)}
      href={href}
      onClick={onClick}
      disabled={Component === 'button' ? disabled : undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        'group relative flex min-h-32 w-full flex-col rounded-lg border p-4 text-left transition-colors',
        interactive
          ? 'cursor-pointer border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--muted-light)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)] disabled:pointer-events-none disabled:opacity-60'
          : null,
        selected
          ? 'border-[var(--muted-light)] bg-[var(--surface-subtle)]'
          : null,
        !interactive && !selected
          ? 'border-[var(--border)] bg-[var(--surface-elevated)]'
          : null,
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          {title ? <div className="truncate text-sm font-medium text-[var(--foreground)]">{title}</div> : null}
          {description ? (
            <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">{description}</div>
          ) : null}
          {children}
        </div>
        {topRight ? <div className="flex shrink-0 items-center gap-1.5">{topRight}</div> : null}
      </div>
      {footer ? (
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[11px] text-[var(--muted-light)]">
          {footer}
        </div>
      ) : null}
    </Component>
  )
}

export interface TileIconProps extends HTMLAttributes<HTMLSpanElement> {
  /** Pixel size for a Lucide icon child. */
  size?: number
}

export function TileIcon({ className, ...props }: TileIconProps) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)] transition-colors group-hover:text-[var(--foreground)]',
        className,
      )}
      {...props}
    />
  )
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Override the rendered element (e.g. next/link). Defaults to a/button/div from href/onClick. */
  as?: ElementType
  href?: string
  onClick?: () => void
  disabled?: boolean
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Trailing slot: actions, badges, meta text. */
  trailing?: ReactNode
}

/**
 * Horizontal list item for list pages: leading media, title + description,
 * trailing action. The row-level hover/selection language matches Tile so
 * grids and lists read as one system.
 */
export function ListRow({
  as,
  href,
  onClick,
  disabled,
  leading,
  title,
  description,
  trailing,
  className,
  children,
  ...props
}: ListRowProps) {
  const interactive = Boolean(href || onClick) && !disabled
  const Component = (as ?? (href ? 'a' : onClick ? 'button' : 'div')) as ElementType
  return (
    <Component
      {...(Component === 'button' && !('type' in props) ? { type: 'button' } : null)}
      href={href}
      onClick={onClick}
      disabled={Component === 'button' ? disabled : undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        interactive
          ? 'cursor-pointer hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)] disabled:pointer-events-none disabled:opacity-60'
          : null,
        className,
      )}
      {...props}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--foreground)]">{title}</div>
        {description ? <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{description}</div> : null}
        {children}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </Component>
  )
}

export function TileSkeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4', className)}
      {...props}
    >
      <div className="flex items-start gap-3">
        <div className="ui-skeleton-line h-9 w-9 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="ui-skeleton-line h-3.5 w-1/3 rounded" />
          <div className="ui-skeleton-line h-3 w-2/3 rounded opacity-75" />
        </div>
      </div>
      <div className="ui-skeleton-line mt-6 h-3 w-24 rounded opacity-75" />
    </div>
  )
}

export interface CreateTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode
  icon?: ReactNode
}

export function CreateTile({ label, icon, className, ...props }: CreateTileProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--foreground)]',
        className,
      )}
      {...props}
    >
      {icon ?? <Plus size={20} strokeWidth={1.75} />}
      {label}
    </button>
  )
}
