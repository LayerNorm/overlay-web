'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { redactUrlForTelemetry, routeForTelemetry } from '@/shared/security/safe-url'

function posthogConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim() && process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim(),
  )
}

function clientObservabilityContext(route?: string): Record<string, string> {
  return {
    deployment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ID?.trim() || 'web',
    environment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV?.trim() || 'unknown',
    release: process.env.NEXT_PUBLIC_OVERLAY_RELEASE?.trim() || 'unknown',
    ...(route ? { route } : {}),
  }
}

function shouldCaptureRetention(): boolean {
  const today = new Date().toISOString().slice(0, 10)
  const key = 'overlay:analytics:retention-date'
  try {
    if (window.localStorage.getItem(key) === today) return false
    window.localStorage.setItem(key, today)
    return true
  } catch {
    return true
  }
}

export default function ObservabilityClient() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { capabilities } = useOverlayCapabilities()
  const lastPageviewUrlRef = useRef<string | null>(null)
  const retentionCapturedRef = useRef(false)

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
    try {
      posthog.register(clientObservabilityContext(route))
      posthog.capture('$pageview', {
        $current_url: url,
        route,
      })
    } catch {
      // ignore blocked storage / init failures (common on mobile Safari private mode)
    }
  }, [capabilities.analytics, pathname, searchParams])

  useEffect(() => {
    if (!user) {
      retentionCapturedRef.current = false
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
      })
      const context = clientObservabilityContext(pathname ? routeForTelemetry(pathname) : undefined)
      for (const [key, value] of Object.entries(context)) {
        Sentry.setTag(`overlay.${key}`, value)
      }
    }

    if (!capabilities.analytics || !posthogConfigured()) return

    try {
      posthog.identify(user.id)
      if (!retentionCapturedRef.current && shouldCaptureRetention()) {
        retentionCapturedRef.current = true
        posthog.capture('retention.engaged', { source: 'app' })
      }
    } catch {
      // ignore
    }
  }, [capabilities.analytics, capabilities.errorReporting, pathname, user])

  return null
}
