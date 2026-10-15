import { ShieldCheck } from 'lucide-react'

import { OperatorLockup } from '@/features/admin/OperatorLockup'

export default function DeniedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-(--background) px-6">
      <div className="w-full max-w-xs text-center">
        <OperatorLockup />
        <div className="mt-8 rounded-lg border border-(--border) bg-(--surface) p-6">
          <ShieldCheck className="mx-auto text-(--muted)" size={20} strokeWidth={1.75} />
          <h1 className="mt-3 text-sm font-semibold text-(--foreground)">Administrative access required</h1>
          <p className="mt-1.5 text-xs leading-5 text-(--muted)">
            This account is not an Overlay operator. Contact an administrator to request access.
          </p>
          <a
            className="mt-5 flex h-9 w-full items-center justify-center rounded-md border border-(--border) text-sm font-medium text-(--foreground) transition-colors hover:bg-(--surface-subtle)"
            href="/sign-in"
          >
            Back to sign in
          </a>
        </div>
      </div>
    </main>
  )
}
