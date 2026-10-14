import { ShieldX } from 'lucide-react'
import { AdminLogo } from '@/components/AdminLogo'

export const dynamic = 'force-dynamic'

export default function DeniedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-(--border) bg-(--surface) p-8 text-center">
        <div className="flex justify-center"><AdminLogo /></div>
        <ShieldX size={22} className="mx-auto mt-8 text-(--muted)" strokeWidth={1.75} />
        <h1 className="mt-4 text-lg font-semibold">Administrative access required</h1>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          This account is not on the operator allowlist, or its administrative principal was revoked. Contact an administrator if you believe this is an error.
        </p>
        <a
          href="/auth/signout"
          className="mt-6 inline-flex h-9 items-center rounded-md border border-(--border) px-4 text-sm text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)"
        >
          Sign out
        </a>
      </div>
    </div>
  )
}
