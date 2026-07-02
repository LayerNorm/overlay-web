'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { redactUrlForTelemetry } from '@/shared/security/safe-url'

function posthogConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim() && process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim(),
  )
}

export default function ObservabilityClient() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { capabilities } = useOverlayCapabilities()
  const lastPageviewUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!capabilities.analytics) return
    if (!posthogConfigured()) return
    const query = searchParams?.toString() ?? ''
    const pathWithQuery = query ? `${pathname}?${query}` : pathname
    if (!pathname) return
    const rawUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${pathWithQuery}` : pathWithQuery
    const url = redactUrlForTelemetry(rawUrl)
    if (lastPageviewUrlRef.current === url) return
    lastPageviewUrlRef.current = url
    try {
      posthog.capture('$pageview', {
        $current_url: url,
      })
    } catch {
      // ignore blocked storage / init failures (common on mobile Safari private mode)
    }
  }, [capabilities.analytics, pathname, searchParams])

  useEffect(() => {
    if (!user) {
      if (capabilities.errorReporting) {
        Sentry.setUser(null)
      }
      if (capabilities.analytics && posthogConfigured()) {
        try {
          posthog.reset()
        } catch {
          // ignore
        }
      }
      return
    }

    if (capabilities.errorReporting) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      })
    }

    if (!capabilities.analytics || !posthogConfigured()) return

    try {
      posthog.identify(user.id, {
        email: user.email,
        first_name: user.firstName ?? undefined,
        last_name: user.lastName ?? undefined,
      })
    } catch {
      // ignore
    }
  }, [capabilities.analytics, capabilities.errorReporting, user])

  return null
}
