'use client'

import { Suspense, useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { AuthProvider, useAuth, type AuthUser } from '@/contexts/AuthContext'
import ObservabilityClient from '@/components/providers/ObservabilityClient'
import { AppSettingsProvider } from '@/components/providers/AppSettingsProvider'
import { ConvexAuthProvider } from '@/components/providers/ConvexAuthProvider'
import { prefetchGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { shouldLoadGatewayModelCatalog } from '@/shared/ai/gateway/catalog-access'

function GatewayModelCatalogPrefetch() {
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'
  const { user, isLoading } = useAuth()
  const enabled = shouldLoadGatewayModelCatalog({
    isAuthenticated: Boolean(user),
    isAuthLoading: isLoading,
    isPublicShowcase: publicShowcase,
  })
  useEffect(() => {
    if (enabled) prefetchGatewayModelCatalog()
  }, [enabled])
  return null
}

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
          <GatewayModelCatalogPrefetch />
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
