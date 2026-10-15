export function MemoriesLoadingState() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-5" role="status" aria-label="Loading memories">
      {Array.from({ length: 2 }).map((_, groupIndex) => (
        <div key={groupIndex}>
          <div className="ui-skeleton-line mb-3 h-2.5 w-20 rounded-sm" />
          <div className="space-y-2">
            {Array.from({ length: groupIndex === 0 ? 3 : 2 }).map((__, rowIndex) => (
              <div
                key={rowIndex}
                className="rounded-xl border border-(--border) bg-(--surface-elevated) px-4 py-4"
              >
                <div className="ui-skeleton-line h-3 w-full rounded-sm" />
                <div className="ui-skeleton-line mt-2 h-3 w-4/5 rounded-sm" />
                <div className="mt-3 flex gap-2">
                  <div className="ui-skeleton-line h-5 w-16 rounded-full" />
                  <div className="ui-skeleton-line h-5 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
