import Link from 'next/link'

const STRUT = '\u200b'

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton-line rounded-md ${className}`} aria-hidden />
}

/** A shared chat or file: the read-only header (title, meta line, Open Overlay), then the conversation column. */
export function ShareRouteLoading() {
  return (
    <div className="min-h-screen bg-(--background) text-(--foreground)" role="status" aria-label="Loading">
      <header className="sticky top-0 z-10 bg-(--background)">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center text-sm">{STRUT}<SkeletonBlock className="h-3 w-48" /></div>
            <div className="flex items-center text-[11px]">{STRUT}<SkeletonBlock className="h-2.5 w-32" /></div>
          </div>
          <Link href="/" className="shrink-0 rounded-full bg-(--surface-subtle) px-3 py-1 text-xs font-medium text-(--foreground) transition-colors hover:bg-(--surface-muted)">
            Open Overlay
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8" aria-hidden>
        <div className="flex flex-col gap-4">
          <div className="flex justify-end"><SkeletonBlock className="h-10 w-[45%] rounded-2xl" /></div>
          <div className="space-y-2.5">
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-5/6" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
        </div>
      </main>
    </div>
  )
}
