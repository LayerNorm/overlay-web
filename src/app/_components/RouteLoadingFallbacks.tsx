import { OverlayMark } from '@/components/orb/Orb'
import { MARKETING_LOGO_SIZE } from '@/features/marketing/lib/marketingLayout'

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

/**
 * Mirrors the split `LandingAuthPageChrome` layout so the loading state sits
 * exactly where the real components will render — brand panel left (desktop),
 * form column right. The brand lockup renders the real SVG mark (static known
 * content); only the copy + form skeleton.
 */
export function AuthPageSkeleton() {
  return (
    <div
      className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]"
      role="status"
      aria-label="Loading"
    >
      <aside className="hidden w-[45%] flex-col justify-between border-r border-[var(--border)] bg-[var(--surface-subtle)] px-12 py-12 lg:flex xl:px-16">
        <div className="flex items-center gap-2.5">
          <OverlayMark size={MARKETING_LOGO_SIZE} label="" />
          <span className="font-serif text-xl font-medium tracking-tight">overlay</span>
        </div>
        <div className="max-w-md">
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="mt-3 h-9 w-3/4" />
          <SkeletonBlock className="mt-6 h-4 w-4/5" />
          <SkeletonBlock className="mt-2 h-4 w-3/5" />
        </div>
        <div className="flex items-center gap-5">
          <SkeletonBlock className="h-3 w-10" />
          <SkeletonBlock className="h-3 w-12" />
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center px-6 py-16 sm:px-10">
        <div className="my-auto w-full max-w-sm">
          <div className="mb-10 flex items-center justify-center gap-2.5 lg:hidden">
            <OverlayMark size={MARKETING_LOGO_SIZE} label="" />
            <span className="font-serif text-xl font-medium tracking-tight">overlay</span>
          </div>
          <SkeletonBlock className="mb-2 h-8 w-44" />
          <SkeletonBlock className="mb-8 h-4 w-60 max-w-full" />
          <div className="mb-6 space-y-3">
            <SkeletonBlock className="h-11 w-full rounded-xl" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
          </div>
          <SkeletonBlock className="mx-auto my-6 h-3 w-32" />
          <div className="space-y-4">
            <SkeletonBlock className="h-11 w-full rounded-xl" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
          </div>
          <SkeletonBlock className="mt-4 h-11 w-full rounded-xl" />
          <SkeletonBlock className="mx-auto mt-6 h-3 w-48" />
        </div>
      </main>
    </div>
  )
}

export function AuthRouteLoading() {
  return <AuthPageSkeleton />
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
