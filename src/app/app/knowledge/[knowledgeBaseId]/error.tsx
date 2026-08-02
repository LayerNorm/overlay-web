'use client'

import { AppRouteErrorState } from '../../_components/AppRouteErrorState'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <AppRouteErrorState error={error} reset={reset} title="Knowledge base failed to load" />
}
