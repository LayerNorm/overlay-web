import { ShieldCheck } from 'lucide-react'

import { OperatorLockup } from '@/features/admin/OperatorLockup'

const ERROR_MESSAGES: Record<string, string> = {
  auth: 'Sign-in failed. Please try again.',
  reauth: 'Please sign in again to continue.',
  state: 'The sign-in session expired. Please try again.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const errorKey = typeof params.error === 'string' ? params.error
    : params.reauth === '1' ? 'reauth'
    : null
  const message = errorKey ? ERROR_MESSAGES[errorKey] : null

  return (
    <main className="flex min-h-dvh items-center justify-center bg-(--background) px-6">
      <div className="w-full max-w-xs text-center">
        <OperatorLockup />
        <div className="mt-8 rounded-lg border border-(--border) bg-(--surface) p-6">
          <ShieldCheck className="mx-auto text-(--muted)" size={20} strokeWidth={1.75} />
          <h1 className="mt-3 text-sm font-semibold text-(--foreground)">Operator console</h1>
          <p className="mt-1.5 text-xs leading-5 text-(--muted)">
            Restricted to authorized LayerNorm operators.
          </p>
          {message ? (
            <p className="mt-3 text-xs text-red-600 dark:text-red-400">{message}</p>
          ) : null}
          <a
            className="mt-5 flex h-9 w-full items-center justify-center rounded-md bg-(--foreground) text-sm font-medium text-(--background) transition-opacity hover:opacity-90"
            href="/auth/sign-in"
          >
            Continue with WorkOS
          </a>
        </div>
      </div>
    </main>
  )
}
