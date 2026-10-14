
export function DraftSuggestionCard({
  title,
  description,
  badge,
  reason,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  title: string
  description: string
  badge: string
  reason: string
  primaryLabel: string
  secondaryLabel?: string
  onPrimary: () => void
  onSecondary?: () => void
}) {
  return (
    <div className="w-full px-1 py-1.5">
      <div className="max-w-[min(100%,36rem)] rounded-2xl border border-(--border) bg-(--surface-elevated) p-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full border border-(--border) bg-(--surface-subtle) px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-(--muted)">
              {badge}
            </span>
            <p className="mt-2 text-sm font-medium text-(--foreground)">{title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-(--muted)">{description}</p>
            <p className="mt-2 text-[11px] text-(--muted)">{reason}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrimary}
            className="inline-flex items-center rounded-md border border-(--border) bg-(--foreground) px-3 py-1.5 text-[12px] font-medium text-(--background) transition-colors hover:opacity-85"
          >
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={onSecondary}
              className="inline-flex items-center rounded-md border border-(--border) bg-(--surface-subtle) px-3 py-1.5 text-[12px] font-medium text-(--foreground) transition-colors hover:bg-(--border)"
            >
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
