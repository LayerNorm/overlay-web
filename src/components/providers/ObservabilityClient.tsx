'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import { useAuth } from '@/contexts/AuthContext'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { redactUrlForTelemetry, routeForTelemetry } from '@/shared/security/safe-url'
import { clientObservabilityContext, posthogConfigured, withPosthog } from './posthog-client'

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
    const route = routeForTelemetry(pathname)
    if (lastPageviewUrlRef.current === url) return
    lastPageviewUrlRef.current = url
    withPosthog((posthog) => {
      posthog.register(clientObservabilityContext(route))
      posthog.capture('$pageview', {
        $current_url: url,
        route,
      })
    })
  }, [capabilities.analytics, pathname, searchParams])

  useEffect(() => {
    if (!user) {
      if (capabilities.errorReporting) {
        Sentry.setUser(null)
      }
      if (capabilities.analytics && posthogConfigured()) {
        withPosthog((posthog) => posthog.reset())
      }
      return
    }

    if (capabilities.errorReporting) {
      Sentry.setUser({
        id: user.id,
      })
      const context = clientObservabilityContext(pathname ? routeForTelemetry(pathname) : undefined)
      for (const [key, value] of Object.entries(context)) {
        Sentry.setTag(`overlay.${key}`, value)
      }
    }

    if (!capabilities.analytics || !posthogConfigured()) return

    withPosthog((posthog) => posthog.identify(user.id))
  }, [capabilities.analytics, capabilities.errorReporting, pathname, user])

  return null
}
