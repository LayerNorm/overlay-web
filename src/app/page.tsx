import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { RootEntryResolver } from '@/features/showcase/RootEntryResolver'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

export default async function Page() {
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
