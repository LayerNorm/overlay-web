import { AppRouteSessionRecovery } from '../_components/AppRouteSessionRecovery'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialIntegrationsData } from '@/server/app/route-data'
import { IntegrationsRouteSkeleton } from '../_components/AppRouteSkeletons'

const IntegrationsView = dynamic(() => import('@/features/integrations/components/IntegrationsView'), {
  loading: () => <IntegrationsRouteSkeleton />,
})

async function IntegrationsRouteContent() {
  const session = await getOverlaySession()
  if (!session) return <AppRouteSessionRecovery />
  const initialData = await getInitialIntegrationsData()
  return <IntegrationsView userId={session.user.id} initialData={initialData} />
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsRouteSkeleton />}>
      <IntegrationsRouteContent />
    </Suspense>
  )
}
