import { Suspense } from 'react'
import { WorkPage } from '@/features/work/components/WorkPage'
import { WorkRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function WorkRoutePage() {
  // WorkPage reads the scope and view from the URL (`useSearchParams`), which needs a Suspense boundary.
  // It also gates on the runtime `work` capability: that cannot be decided here, because this route's
  // static shell is prerendered at build time without the deployment's feature flags.
  return (
    <Suspense fallback={<WorkRouteSkeleton />}>
      <WorkPage fallback={<WorkRouteSkeleton />} />
    </Suspense>
  )
}
