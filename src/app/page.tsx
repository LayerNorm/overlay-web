import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { RootEntryResolver } from '@/features/showcase/RootEntryResolver'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

function RootEntryFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p role="status" className="text-sm text-[var(--muted)]">
        Opening Overlay…
      </p>
    </main>
  )
}

async function SessionGate() {
  let session: Awaited<ReturnType<typeof getOverlaySession>> = null
  let sessionResolved = false
  try {
    // Refresh-capable so a resolved-null session below means a confirmed
    // guest — matching the client resolver's /api/auth/session check.
    session = await getOverlaySession(undefined, { refresh: true })
    sessionResolved = true
  } catch {
    // The refresh-capable client resolver below deliberately handles
    // transient provider/configuration failures without treating them as a
    // confirmed guest session.
  }

  if (session) redirect(ROOT_APP_DESTINATION)
  // A resolved empty session is a confirmed guest: send visitors (and
  // crawlers) to the marketing page with a real redirect instead of a
  // client-side navigation.
  if (sessionResolved) redirect('/home')
  return <RootEntryResolver />
}

export default function Page() {
  return (
    <Suspense fallback={<RootEntryFallback />}>
      <SessionGate />
    </Suspense>
  )
}
