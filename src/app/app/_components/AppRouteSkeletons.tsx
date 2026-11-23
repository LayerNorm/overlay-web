'use client'

import { AppScreenHeader, type AppScreenHeaderProps } from '@overlay/modules-react/shell'
import { AppBootLoader } from '@/components/layout/AppBootLoader'
import { bootAppShown } from '@/components/layout/boot-loader-state'

/**
 * Route loading UI shares one rule: real chrome, placeholder data. Route skeletons render the real `AppScreenHeader`
 * (inside the shell it picks up the same breadcrumbs and sidebar toggle as the loaded page) and draw placeholders only
 * where data will appear, using the loaded view's own column and row geometry. See internal/develop/interface-design.md.
 */

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton-line rounded-md ${className}`} aria-hidden />
}

/** The real page header, for route skeletons. Pass the loaded page's title; data-bound parts become placeholders. */
export function RouteSkeletonHeader(props: AppScreenHeaderProps) {
  return <AppScreenHeader {...props} />
}

/** A route with no skeleton of its own: the header row and an empty body, never another page's content. */
export function NeutralRouteSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col bg-(--background)" role="status" aria-label="Loading">
      <RouteSkeletonHeader />
    </div>
  )
}

/** Outside the app shell (no rail or sidebar): the boot loader on first load, then a plain page. */
export function AppShellLoadingFallback({ settled = false }: { settled?: boolean }) {
  if (bootAppShown.wasShown()) return <div className="h-full min-h-screen bg-(--background)" role="status" aria-label="Loading" />
  return <AppBootLoader settled={settled} />
}

/** `/app` segment fallback for routes without their own `loading.tsx`. */
export function InitialAppLoading({ settled = true }: { settled?: boolean }) {
  // The brand loader is a boot screen: once the app has rendered real content,
  // route fallbacks show a neutral page instead of re-flashing the lockup.
  if (bootAppShown.wasShown()) return <NeutralRouteSkeleton />
  return <AppBootLoader settled={settled} />
}
