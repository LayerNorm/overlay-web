import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { AdminLogo } from '@/components/AdminLogo'

/**
 * Console chrome: a narrow left rail with the OverlayMark lockup and section
 * nav, a top bar carrying the signed-in operator and sign-out, and the
 * section body. Deliberately standalone (not the customer AppScreenShell —
 * its nav points at customer routes that do not exist here).
 */
export function AdminShell({
  nav,
  email,
  children,
}: {
  nav: ReactNode
  email: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen" data-testid="admin-console">
      <aside className="flex w-14 shrink-0 flex-col border-r border-(--border) bg-(--surface) sm:w-60">
        <div className="flex h-14 items-center gap-2.5 border-b border-(--border) px-3 sm:px-4">
          <span className="hidden sm:inline"><AdminLogo /></span>
          <span className="sm:hidden"><AdminLogo size={9} /></span>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-(--border) px-3 py-3 text-[11px] uppercase tracking-wider text-(--muted) max-sm:hidden">
          Operator console
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-(--border) bg-(--surface) px-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Administration</h1>
            <p className="truncate text-xs text-(--muted)">Workspace controls</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden truncate text-xs text-(--muted) sm:inline" title={email}>{email}</span>
            {/* Sign-out is a plain link (GET route clears the cookie); the nav
                forms still validate CSRF through the SameSite=lax cookie. */}
            <a
              href="/auth/signout"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-(--border) px-3 text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)"
            >
              <LogOut size={13} strokeWidth={1.75} />
              Sign out
            </a>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  )
}
