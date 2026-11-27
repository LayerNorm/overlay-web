'use client'

/**
 * Loading placeholders that share the geometry of the rows they stand in for. Change one alongside the row it mirrors.
 * Shimmer comes from `.ui-skeleton-line` / `.ui-skeleton-mesh`.
 */

// A fixed spread of widths (by position), so server and client render the same bars.
const BAR_WIDTHS = ['70%', '52%', '62%', '45%', '58%', '66%']

export type SidebarRowSkeletonIcon = 'square' | 'round' | 'none'

/**
 * Sidebar list rows as `<li>` items, for use inside a `SidebarMenuSub` / `SidebarMenu` list. Each mirrors
 * `SidebarMenuSubButton`: one line, `h-8 px-2 gap-2.5`, with a 12–16px leading icon.
 */
export function SidebarRowItemsSkeleton({
  rows = 5,
  icon = 'square',
  iconSize = 16,
}: {
  rows?: number
  icon?: SidebarRowSkeletonIcon
  iconSize?: 12 | 14 | 16
}) {
  const iconClass = iconSize === 12 ? 'size-3' : iconSize === 14 ? 'size-3.5' : 'size-4'
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="min-w-0" aria-hidden>
          <div className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2">
            {icon === 'none' ? null : (
              <div className={`ui-skeleton-line ${iconClass} shrink-0 ${icon === 'round' ? 'rounded-full' : 'rounded-sm'}`} />
            )}
            <div className="ui-skeleton-line h-2.5 flex-1 rounded-sm" style={{ maxWidth: BAR_WIDTHS[i % BAR_WIDTHS.length] }} />
          </div>
        </li>
      ))}
    </>
  )
}

/** A standalone sidebar list of loading rows (its own `<ul>`), same rhythm as `SidebarMenuSub` (`gap-0.5`). */
export function SidebarListSkeleton({
  rows = 5,
  icon = 'square',
  iconSize = 16,
  className = '',
}: {
  rows?: number
  icon?: SidebarRowSkeletonIcon
  iconSize?: 12 | 14 | 16
  className?: string
}) {
  return (
    <ul role="status" aria-label="Loading" className={`flex min-w-0 list-none flex-col gap-0.5 ${className}`}>
      <SidebarRowItemsSkeleton rows={rows} icon={icon} iconSize={iconSize} />
    </ul>
  )
}

/** One `SettingsGroup` of `SettingRow`s: a bordered `divide-y` panel of `px-4 py-3.5` rows with an 18px icon. */
export function SettingsSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) divide-y divide-(--border)"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start justify-between gap-4 px-4 py-3.5" aria-hidden>
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="ui-skeleton-line mt-0.5 size-[18px] shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1">
              <div className="flex h-5 items-center">
                <div className="ui-skeleton-line h-3 w-36 rounded-sm" />
              </div>
              <div className="mt-1 flex h-[22px] items-center">
                <div className="ui-skeleton-line h-2.5 w-full max-w-sm rounded-sm" style={{ maxWidth: BAR_WIDTHS[(i + 1) % BAR_WIDTHS.length] }} />
              </div>
            </div>
          </div>
          <div className="ui-skeleton-line h-7 w-12 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** The Files list view: flat `px-3 py-2.5` bordered rows with a 14px icon, `space-y-0.5`, in a `max-w-3xl` column. */
export function FileListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-3xl space-y-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2.5" aria-hidden>
          <div className="ui-skeleton-line size-3.5 shrink-0 rounded-sm" />
          <div className="flex h-[22px] flex-1 items-center">
            <div className="ui-skeleton-line h-3 flex-1 rounded-sm" style={{ maxWidth: BAR_WIDTHS[i % BAR_WIDTHS.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Memory list rows: two lines in `px-3 py-2.5` rows, `space-y-0.5`, in a `max-w-3xl` column. */
export function KnowledgeListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-3xl space-y-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-transparent px-3 py-2.5" aria-hidden>
          <div className="ui-skeleton-line h-3 rounded-sm" style={{ width: `${85 - (i % 4) * 5}%` }} />
          <div className="ui-skeleton-line h-3 rounded-sm opacity-80" style={{ width: `${60 - (i % 3) * 4}%` }} />
        </div>
      ))}
    </div>
  )
}
