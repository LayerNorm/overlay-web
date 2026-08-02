'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ShieldX } from 'lucide-react'
import { useAuthorization } from './AuthorizationProvider'
import {
  getAppRouteAuthorizationRequirement,
  getSettingsSectionAuthorizationRequirement,
  satisfiesAuthorizationRequirement,
} from '@/shared/authorization/client-policy'

export function AuthorizationRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const { allows, authorization } = useAuthorization()
  const requirement = pathname.startsWith('/app/settings')
    ? getSettingsSectionAuthorizationRequirement(searchParams.get('section') ?? 'general')
    : getAppRouteAuthorizationRequirement(pathname)
  const allowed = authorization && pathname.startsWith('/app/admin')
    ? satisfiesAuthorizationRequirement(authorization, requirement)
    : allows(requirement)

  if (authorization && !allowed) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16" data-testid="authorization-route-denied">
        <div className="max-w-md text-center">
          <ShieldX className="mx-auto text-[var(--muted)]" size={24} />
          <h1 className="mt-4 text-lg font-semibold">Access not available</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your current role does not include access to this area.
          </p>
          <Link
            href="/app/chat"
            className="mt-5 inline-flex h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-subtle)]"
          >
            Return to chat
          </Link>
        </div>
      </div>
    )
  }

  return children
}
