import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Loader2 } from 'lucide-react'
import { getOverlaySession } from '@/server/auth/session'
import { AppShellSidebar } from './_components/AppShellSidebar'
import { AsyncSessionsProvider } from '@/components/providers/async-sessions-store'
import BackgroundPollManager from '@/components/providers/BackgroundPollManager'
import { NavigationProgressProvider, NavigationProgressBar } from '@/components/providers/navigation-progress'
import { GuestGateProvider } from '@/components/providers/GuestGateProvider'
import { OnboardingProvider } from '@/components/providers/OnboardingProvider'
import { CapabilitiesProvider } from '@/components/providers/CapabilitiesProvider'
import { AuthorizationProvider } from '@/components/providers/AuthorizationProvider'
import { AuthorizationRouteGuard } from '@/components/providers/AuthorizationRouteGuard'
import { AppClientProviders } from '@/components/providers/AppClientProviders'
import type { AppAuthorizationState } from '@overlay/app-core'
import { getAppDataCapabilitiesSync, getOverlayCapabilitiesSync } from '@/server/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizationEnforcementMode } from '@/server/authorization'
import { AppConfigurationErrorState } from './_components/AppConfigurationErrorState'
import { AppShellLoadingFallback, ChatRouteSkeleton } from './_components/AppRouteSkeletons'
import { getSelectedIntegrationProviderId } from '@/server/integrations'
import { WorkspaceAppBoundary } from '@/features/workspaces/components/WorkspaceAppBoundary'
import { WorkspaceScopedContentBoundary } from '@/features/workspaces/components/WorkspaceScopedContentBoundary'
import { CollaborationRealtimeProvider } from '@/features/chat/components/collaboration/CollaborationRealtimeProvider'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

function AppMainFallback() {
  return <ChatRouteSkeleton />
}

function WorkspaceSwitchFallback() {
  return (
    <div className="flex min-h-full items-center justify-center text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Switching workspace…
      </span>
    </div>
  )
}

async function AppLayoutContent({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof getOverlaySession>>
  let capabilities: ReturnType<typeof getOverlayCapabilitiesSync>
  let appDataCapabilities: ReturnType<typeof getAppDataCapabilitiesSync>
  let authorization: AppAuthorizationState | null
  try {
    session = await getOverlaySession()
    capabilities = getOverlayCapabilitiesSync()
    appDataCapabilities = getAppDataCapabilitiesSync()
    if (session?.user) {
      const server = getOverlayServerContext()
      await server.fixedRoleAuthorizationBridge.ensureDefaultUserRole(session.user.id)
      authorization = {
          ...(await server.authorizationService.resolveSubject(session.user.id)),
          enforcementMode: getAuthorizationEnforcementMode(),
      }
    } else {
      authorization = null
    }
  } catch (error) {
    return <AppConfigurationErrorState error={error} />
  }

  const user = session?.user ?? null

  return (
    <AppClientProviders
      initialUser={user}
      requiresConvexClient={appDataCapabilities.requiresConvexClient}
    >
      <WorkspaceAppBoundary hasAuthenticatedUser={Boolean(user)}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <AsyncSessionsProvider>
          <NavigationProgressProvider>
            <NavigationProgressBar />
            <CapabilitiesProvider
              initialAppDataCapabilities={appDataCapabilities}
              initialCapabilities={capabilities}
              initialIntegrationProvider={getSelectedIntegrationProviderId()}
            >
              <CollaborationRealtimeProvider>
                <AuthorizationProvider authorization={authorization}>
                  <BackgroundPollManager />
                  <GuestGateProvider>
                    <OnboardingProvider>
                      <AppShellSidebar />
                      <main className="app-main flex-1 overflow-auto pt-14 transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:pt-0">
                        <Suspense fallback={<AppMainFallback />}>
                          <WorkspaceScopedContentBoundary fallback={<WorkspaceSwitchFallback />}>
                            <AuthorizationRouteGuard>{children}</AuthorizationRouteGuard>
                          </WorkspaceScopedContentBoundary>
                        </Suspense>
                      </main>
                    </OnboardingProvider>
                  </GuestGateProvider>
                </AuthorizationProvider>
              </CollaborationRealtimeProvider>
            </CapabilitiesProvider>
          </NavigationProgressProvider>
        </AsyncSessionsProvider>
        </div>
      </WorkspaceAppBoundary>
    </AppClientProviders>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellLoadingFallback />}>
      <AppLayoutContent>{children}</AppLayoutContent>
    </Suspense>
  )
}
