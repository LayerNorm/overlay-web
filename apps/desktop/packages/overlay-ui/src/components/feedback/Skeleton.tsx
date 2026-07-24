'use client'

/**
 * Shimmer placeholders aligned with `.media-gen-mesh` / `.ui-skeleton-*`.
 */

export function SidebarListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-1" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2.5 py-2">
          <div className="ui-skeleton-line h-3 w-3 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div
              className="ui-skeleton-line h-2.5 rounded"
              style={{ width: `${68 + ((i * 7) % 24)}%` }}
            />
            <div className="ui-skeleton-line h-2 w-2/5 rounded opacity-70" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function OutputCardSkeleton() {
  return (
    <div
      className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]"
      style={{ breakInside: 'avoid' }}
      aria-hidden
    >
      <div className="ui-skeleton-mesh h-36 w-full rounded-t-xl rounded-b-none" />
      <div className="space-y-2 px-3 py-2.5">
        <div className="ui-skeleton-line h-3 w-4/5 rounded" />
        <div className="ui-skeleton-line h-2.5 w-3/5 rounded opacity-80" />
        <div className="ui-skeleton-line h-2 w-2/5 rounded opacity-60" />
      </div>
    </div>
  )
}

export function OutputListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5" aria-hidden>
      <div className="ui-skeleton-mesh h-11 w-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="ui-skeleton-line h-3.5 w-3/5 rounded" />
        <div className="ui-skeleton-line h-2.5 w-2/5 rounded opacity-75" />
      </div>
      <div className="flex shrink-0 gap-1">
        <div className="ui-skeleton-line h-7 w-16 rounded-md" />
        <div className="ui-skeleton-line h-7 w-7 rounded-md" />
      </div>
    </div>
  )
}

export function SettingsSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-sm"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="ui-skeleton-mesh h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="ui-skeleton-line h-3.5 w-40 rounded" />
              <div className="ui-skeleton-line h-3 w-full max-w-md rounded" />
              <div className="ui-skeleton-line h-3 w-4/5 max-w-md rounded opacity-80" />
            </div>
          </div>
          <div className="ui-skeleton-line h-7 w-12 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function KnowledgeListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-2 py-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-transparent px-3 py-2.5"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div
                className="ui-skeleton-line h-3 rounded"
                style={{ width: `${85 - (i % 4) * 5}%` }}
              />
              <div
                className="ui-skeleton-line h-3 rounded opacity-80"
                style={{ width: `${60 - (i % 3) * 4}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function FileTreeSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-1 py-1" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg px-3 py-2.5"
          style={{ paddingLeft: `${12 + (i % 3) * 14}px` }}
        >
          <div className="ui-skeleton-line h-3 w-3 shrink-0 rounded" />
          <div className="ui-skeleton-line h-3 flex-1 rounded" style={{ maxWidth: `${70 + (i % 5) * 5}%` }} />
        </div>
      ))}
    </div>
  )
}

export function IntegrationsGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
        >
          <div className="flex items-center gap-3">
            <div className="ui-skeleton-mesh h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="ui-skeleton-line h-3 w-3/4 rounded" />
              <div className="ui-skeleton-line h-2.5 w-1/2 rounded opacity-70" />
            </div>
          </div>
          <div className="ui-skeleton-line h-2.5 w-full rounded" />
          <div className="ui-skeleton-line h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function ProjectsPageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 py-4" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
        >
          <div className="ui-skeleton-line mb-3 h-4 w-48 rounded" />
          <div className="ui-skeleton-line h-3 w-full rounded opacity-80" />
        </div>
      ))}
    </div>
  )
}

export function IntegrationListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-2xl space-y-1 px-6 py-6" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg px-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="ui-skeleton-mesh h-7 w-7 !min-h-0 shrink-0 rounded-lg" />
            <div className="min-w-0 space-y-1.5">
              <div className="ui-skeleton-line h-3 w-40 rounded" />
              <div className="ui-skeleton-line h-2.5 max-w-[14rem] rounded opacity-80" />
            </div>
          </div>
          <div className="ui-skeleton-line ml-4 h-8 w-[4.5rem] shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function IntegrationDialogRowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--border)]" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <div className="ui-skeleton-mesh h-8 w-8 !min-h-0 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="ui-skeleton-line h-3 w-[45%] rounded" />
            <div className="ui-skeleton-line h-2.5 w-[72%] rounded opacity-75" />
          </div>
          <div className="ui-skeleton-line h-7 w-[5.5rem] shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function AutomationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6" aria-hidden>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="ui-skeleton-line h-3.5 w-40 rounded" />
                <div className="ui-skeleton-line h-5 w-14 rounded-full" />
                <div className="ui-skeleton-line h-5 w-16 rounded-full" />
              </div>
              <div className="ui-skeleton-line h-2.5 w-[90%] max-w-lg rounded" />
              <div className="ui-skeleton-line h-2 w-[70%] rounded opacity-70" />
            </div>
            <div className="flex shrink-0 gap-1">
              <div className="ui-skeleton-line h-8 w-8 rounded-md" />
              <div className="ui-skeleton-line h-8 w-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RunDetailSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4" aria-hidden>
      <div className="flex gap-2">
        <div className="ui-skeleton-line h-5 w-20 rounded-full" />
        <div className="ui-skeleton-line h-5 w-24 rounded-full" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="ui-skeleton-line h-3 rounded" />
        ))}
      </div>
      <div className="ui-skeleton-line h-24 w-full rounded-lg" />
    </div>
  )
}

export function FileViewerSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-6" aria-hidden>
      <div className="ui-skeleton-line h-4 w-1/3 max-w-xs rounded" />
      <div className="ui-skeleton-mesh min-h-[min(60vh,420px)] w-full flex-1 rounded-lg" />
    </div>
  )
}
