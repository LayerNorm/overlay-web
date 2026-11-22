import { Suspense } from 'react'
import { OrganizationPage } from '@/features/work/components/OrganizationPage'
import { OrganizationSkeleton } from '@/features/work/components/WorkSkeletons'

export default function OrganizationRoutePage() {
  return <Suspense fallback={<OrganizationSkeleton />}><OrganizationPage /></Suspense>
}
