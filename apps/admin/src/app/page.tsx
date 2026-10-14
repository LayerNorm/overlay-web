import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AdminConsolePage } from '@/features/admin/AdminConsolePage'
import { SessionTouch } from '@/features/admin/SessionTouch'
import { getAdminServerContext } from '@/server/context'
import { resolveOperator } from '@/server/operator'
import { ADMIN_SESSION_COOKIE } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const store = await cookies()
  const outcome = await resolveOperator(store.get(ADMIN_SESSION_COOKIE)?.value)
  if (outcome.kind === 'anonymous') redirect('/sign-in')
  if (outcome.kind === 'denied') redirect('/denied')

  const subject = await getAdminServerContext()
    .authorizationService
    .resolveSubject(outcome.user.id)

  return (
    <>
      <SessionTouch />
      <AdminConsolePage capabilities={subject.capabilities as string[]} />
    </>
  )
}
