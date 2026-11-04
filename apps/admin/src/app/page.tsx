import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AdminConsolePage } from '@/features/admin/AdminConsolePage'
import { ADMIN_THEME_COOKIE, parseAdminTheme } from '@/features/admin/admin-theme'
import { SessionTouch } from '@/features/admin/SessionTouch'
import { operatorCapabilities } from '@/server/operator-permissions'
import { resolveOperator } from '@/server/operator'
import { ADMIN_SESSION_COOKIE } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const store = await cookies()
  const outcome = await resolveOperator(store.get(ADMIN_SESSION_COOKIE)?.value)
  if (outcome.kind === 'anonymous') redirect('/sign-in')
  if (outcome.kind === 'denied') redirect('/denied')

  const capabilities = operatorCapabilities(outcome.principal)
  const { user } = outcome
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email

  return (
    <>
      <SessionTouch />
      <AdminConsolePage
        capabilities={capabilities}
        operator={{ name, email: user.email, role: outcome.principal.role }}
        theme={parseAdminTheme(store.get(ADMIN_THEME_COOKIE)?.value)}
      />
    </>
  )
}
