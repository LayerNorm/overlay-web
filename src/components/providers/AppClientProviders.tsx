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
}: {
  children: ReactNode
  initialUser: AuthUser | null
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <AppSettingsProvider>
        <ConvexAuthProvider>
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
