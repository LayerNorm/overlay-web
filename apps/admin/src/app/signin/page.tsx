import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ShieldCheck } from 'lucide-react'
import { AdminLogo } from '@/components/AdminLogo'
import { checkOperator } from '@/server/operator-gate'
import { SignInError } from './SignInError'

export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  // Already signed in and authorized → straight to the console.
  const gate = await checkOperator()
  if (gate.ok) redirect('/')

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-(--border) bg-(--surface) p-8">
        <AdminLogo />
        <div className="mt-8 flex items-center gap-2 text-(--muted)">
          <ShieldCheck size={15} strokeWidth={1.75} />
          <span className="text-xs font-medium uppercase tracking-wider">Operator console</span>
        </div>
        <h1 className="mt-3 text-lg font-semibold">Administrative sign-in</h1>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          Access is restricted to authorized Overlay operators. Continue with your WorkOS account; membership in the operator allowlist and an active administrative principal are verified after sign-in.
        </p>
        <Suspense fallback={null}>
          <SignInError />
        </Suspense>
        <a
          href="/auth/workos"
          className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-(--button-primary-bg) text-sm font-medium text-(--button-primary-fg) transition-opacity hover:opacity-90"
        >
          Continue with WorkOS
        </a>
      </div>
    </div>
  )
}
