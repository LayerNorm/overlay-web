import { Suspense } from 'react'
import { OrganizationPage } from '@/features/work/components/OrganizationPage'
import { WorkRouteSkeleton } from '../../_components/AppRouteSkeletons'

export default function OrganizationRoutePage() {
  return <Suspense fallback={<WorkRouteSkeleton />}><OrganizationPage /></Suspense>
}
