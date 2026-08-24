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

function GatewayModelCatalogPrefetch({ publicShowcase: forcedPublicShowcase }: { publicShowcase: boolean }) {
  const searchParams = useSearchParams()
  const publicShowcase = forcedPublicShowcase || searchParams?.get('showcase') === '1'
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
  publicShowcase = false,
  requiresConvexClient,
}: {
  children: ReactNode
  initialUser: AuthUser | null
  publicShowcase?: boolean
  requiresConvexClient?: boolean
}) {
  return (
    <AuthProvider
      initialUser={initialUser}
      initialSessionResolved={Boolean(initialUser)}
    >
      <AppSettingsProvider>
        <ConvexAuthProvider requiresConvexClient={requiresConvexClient}>
          <GatewayModelCatalogPrefetch publicShowcase={publicShowcase} />
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
