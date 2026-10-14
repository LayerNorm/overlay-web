import { redirect } from 'next/navigation'
import { checkOperator } from '@/server/operator-gate'
import { AdminConsole } from '@/app/AdminConsole'

export const dynamic = 'force-dynamic'

/**
 * The console root. The operator gate runs here for page loads: no session →
 * /signin; session but not allowlisted or revoked principal → /denied.
 * (Cookie writes are not allowed in Server Components, so the read-only gate
 * is used; API calls perform the sliding idle renewal.)
 */
export default async function AdminPage() {
  const gate = await checkOperator()
  if (!gate.ok) {
    redirect(gate.reason === 'no-session' ? '/signin' : '/denied')
  }
  return (
    <AdminConsole
      email={gate.operator.email}
      userId={gate.operator.userId}
      role={gate.operator.role}
      capabilities={gate.operator.capabilities}
    />
  )
}
