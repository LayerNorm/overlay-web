'use client'

import { Suspense, type ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { AuthProvider, type AuthUser } from '@/contexts/AuthContext'
import ObservabilityClient from '@/components/providers/ObservabilityClient'
import { AppSettingsProvider } from '@/components/providers/AppSettingsProvider'
import { ConvexAuthProvider } from '@/components/providers/ConvexAuthProvider'

export function AppClientProviders({
  children,
  initialUser,
  requiresConvexClient,
}: {
  children: ReactNode
  initialUser: AuthUser | null
  requiresConvexClient?: boolean
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <AppSettingsProvider>
        <ConvexAuthProvider requiresConvexClient={requiresConvexClient}>
          <Suspense fallback={null}>
            <ObservabilityClient />
          </Suspense>
          {children}
          <Analytics />
          <SpeedInsights />
        </ConvexAuthProvider>
      </AppSettingsProvider>
    </AuthProvider>
  )
}
