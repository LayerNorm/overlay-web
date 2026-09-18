function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton-line rounded-md ${className}`} aria-hidden />
}

export function MarketingRouteLoading() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <div className="mb-16 flex items-center justify-between">
          <SkeletonBlock className="h-5 w-28" />
          <div className="hidden items-center gap-3 md:flex">
            <SkeletonBlock className="h-4 w-16" />
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-8 w-24 rounded-full" />
          </div>
        </div>
        <div className="max-w-3xl space-y-5">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-12 w-full max-w-2xl" />
          <SkeletonBlock className="h-12 w-full max-w-xl" />
          <div className="space-y-3 pt-2">
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-full max-w-xl" />
            <SkeletonBlock className="h-4 w-full max-w-lg" />
          </div>
        </div>
      </div>
    </main>
  )
}

export function AuthRouteLoading() {
  return (
    <main className="flex min-h-screen bg-[var(--background)] px-6">
      <div className="w-full max-w-sm">
        <SkeletonBlock className="mb-6 h-7 w-40" />
        <SkeletonBlock className="mb-8 h-4 w-56" />
        <SkeletonBlock className="mb-3 h-11 w-full rounded-xl" />
        <SkeletonBlock className="mb-3 h-11 w-full rounded-xl" />
        <SkeletonBlock className="h-11 w-full rounded-xl" />
      </div>
    </main>
  )
}

export function ShareRouteLoading() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <SkeletonBlock className="h-5 w-40" />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
          <SkeletonBlock className="mb-4 h-4 w-48" />
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-5/6" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    </main>
  )
}
