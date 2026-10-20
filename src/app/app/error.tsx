'use client'

import { AppRouteErrorState } from './_components/AppRouteErrorState'

// Catches pages without their own boundary so a page error keeps the app shell
// instead of falling through to the root error screen.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <AppRouteErrorState error={error} reset={reset} title="This page failed to load" />
}
