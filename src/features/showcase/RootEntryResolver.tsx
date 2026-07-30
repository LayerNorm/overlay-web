'use client'

import { useEffect } from 'react'
import {
  ROOT_APP_DESTINATION,
  classifyRootSessionResponse,
  resolveRootEntryDestination,
} from '@/shared/auth/root-entry'

export function RootEntryResolver() {
  useEffect(() => {
    let cancelled = false

    async function resolveEntry() {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const body = response.ok
          ? await response.json().catch(() => null) as {
              authenticated?: boolean
              user?: { id?: string }
            } | null
          : null
        const resolution = classifyRootSessionResponse({
          ok: response.ok && Boolean(body),
          authenticated: body?.authenticated,
          hasUser: Boolean(body?.user?.id),
        })
        const destination = resolveRootEntryDestination(resolution)

        if (!cancelled) {
          // Routing into the app is safe on a transient auth failure because
          // the app remains server-authorized. Most importantly, a provider
          // outage can never misclassify a real user as a showcase guest.
          window.location.replace(destination ?? ROOT_APP_DESTINATION)
        }
      } catch {
        if (!cancelled) window.location.replace(ROOT_APP_DESTINATION)
      }
    }

    void resolveEntry()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p role="status" className="text-sm text-[var(--muted)]">
        Opening Overlay…
      </p>
    </main>
  )
}
