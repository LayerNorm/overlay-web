import { Suspense } from 'react'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'
import { WorkPage } from '@/features/work/components/WorkPage'
import { WorkRouteSkeleton } from '../_components/AppRouteSkeletons'

function DisabledWorkRoute() {
  return (
    <AppScreenShell>
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-(--foreground)">Work unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            Work is turned off for this deployment.
          </p>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

export default function WorkRoutePage() {
  // Env-only, so it can be read before the Suspense boundary without blocking.
  if (!getOverlayCapabilitiesSync().work) return <DisabledWorkRoute />
  // WorkPage reads the scope and view from the URL (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense fallback={<WorkRouteSkeleton />}>
      <WorkPage />
    </Suspense>
  )
}
