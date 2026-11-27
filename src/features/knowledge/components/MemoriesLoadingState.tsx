/** The Memories list while it loads: the loaded column (`max-w-3xl space-y-6 px-6 py-4`), group labels and memory cards. */
export function MemoriesLoadingState() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-4" role="status" aria-label="Loading memories">
      {Array.from({ length: 2 }).map((_, groupIndex) => (
        <div key={groupIndex} aria-hidden>
          <div className="mb-2 flex h-[16.5px] items-center">
            <div className="ui-skeleton-line h-2 w-20 rounded-sm" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: groupIndex === 0 ? 3 : 2 }).map((__, rowIndex) => (
              <div key={rowIndex} className="rounded-xl border border-(--border) bg-(--surface-elevated) px-3 py-3">
                <div className="flex h-[22.75px] items-center">
                  <div className="ui-skeleton-line h-3 rounded-sm" style={{ width: `${88 - ((groupIndex + rowIndex) % 3) * 12}%` }} />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <div className="ui-skeleton-line h-[21px] w-24 rounded-full" />
                  <div className="ui-skeleton-line h-[21px] w-14 rounded-full" />
                </div>
                <div className="mt-2 flex h-[16.5px] items-center">
                  <div className="ui-skeleton-line h-2 w-12 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
