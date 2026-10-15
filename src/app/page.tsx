import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { AppBootLoader } from '@/components/layout/AppBootLoader'
import { RootEntryResolver } from '@/features/showcase/RootEntryResolver'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

function RootEntryFallback() {
  return <AppBootLoader />
}

async function SessionGate() {
  let session: Awaited<ReturnType<typeof getOverlaySession>> = null
  try {
    session = await getOverlaySession()
  } catch {
    // The refresh-capable client resolver below deliberately handles
    // transient provider/configuration failures without treating them as a
    // confirmed guest session.
  }

  if (session) redirect(ROOT_APP_DESTINATION)
  return <RootEntryResolver />
}

export default function Page() {
  return (
    <Suspense fallback={<RootEntryFallback />}>
      <SessionGate />
    </Suspense>
  )
}
