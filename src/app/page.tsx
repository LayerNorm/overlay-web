import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'

export default async function Page() {
  const session = await getOverlaySession()
  if (session) redirect('/app/chat')
  redirect('/app/chat?showcase=1&id=showcase-welcome')
}
