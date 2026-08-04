import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { redirect } from 'next/navigation'
import { getInitialIntegrationsData } from '@/server/app/route-data'
import { IntegrationsRouteSkeleton } from '../_components/AppRouteSkeletons'

const IntegrationsView = dynamic(() => import('@/features/integrations/components/IntegrationsView'), {
  loading: () => <IntegrationsRouteSkeleton />,
})

async function IntegrationsRouteContent() {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')
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
