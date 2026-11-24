/**
 * `AutomationGraphCanvas` while its code or run data loads, at the canvas's own geometry: the optional hint line above
 * (editor), the optional live status line, the bordered `h-96` canvas, and the optional replay scrubber below.
 */
export function AutomationCanvasSkeleton({ hint = false, status = false, scrubber = false }: { hint?: boolean; status?: boolean; scrubber?: boolean }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading flow">
      {hint ? (
        <div aria-hidden>
          <div className="flex h-4 items-center"><div className="ui-skeleton-line h-2.5 w-full rounded-sm" /></div>
          <div className="flex h-4 items-center"><div className="ui-skeleton-line h-2.5 w-2/5 rounded-sm" /></div>
        </div>
      ) : null}
      {status ? <div aria-hidden className="flex h-4 items-center"><div className="ui-skeleton-line h-2.5 w-40 rounded-sm" /></div> : null}
      <div aria-hidden className="overflow-hidden rounded-lg border border-(--border)">
        <div className="ui-skeleton-mesh h-96" />
      </div>
      {scrubber ? (
        <div aria-hidden className="space-y-2">
          <div className="flex h-4 items-center justify-between">
            <div className="ui-skeleton-line h-2.5 w-20 rounded-sm" />
            <div className="ui-skeleton-line h-2.5 w-24 rounded-sm" />
          </div>
          <div className="flex h-5 items-center"><div className="ui-skeleton-line h-1.5 w-full rounded-full" /></div>
          <div className="flex gap-1">
            {[44, 36, 52, 40].map((width) => <div key={width} className="ui-skeleton-line h-[19px] rounded" style={{ width }} />)}
          </div>
        </div>
      ) : null}
    </div>
  )
}
