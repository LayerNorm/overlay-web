import { DesktopProvider } from '@/components/desktop/DesktopProvider'
import { ensureDefaultUserRole } from '@/server/authorization/ensure-default-user-role'
import { Suspense } from 'react'
import { OnboardingShell } from './onboarding/OnboardingShell'
import { Loader2 } from 'lucide-react'
import { getOverlaySession } from '@/server/auth/session'
import { AppShellSidebar } from '@/app/app/_components/AppShellSidebar'
import { AsyncSessionsProvider } from '@/components/providers/async-sessions-store'
import BackgroundPollManager from '@/components/providers/BackgroundPollManager'
import { NavigationProgressProvider, NavigationProgressBar } from '@/components/providers/navigation-progress'
import { GuestGateProvider } from '@/components/providers/GuestGateProvider'
import { CapabilitiesProvider } from '@/components/providers/CapabilitiesProvider'
import { AuthorizationProvider } from '@/components/providers/AuthorizationProvider'
import { AuthorizationRouteGuard } from '@/components/providers/AuthorizationRouteGuard'
import { AppClientProviders, GatewayModelCatalogPrefetch } from '@/components/providers/AppClientProviders'
import type { AppAuthorizationState } from '@overlay/app-core'
import { getAppDataCapabilitiesSync, getOverlayCapabilitiesSync } from '@/server/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizationEnforcementMode } from '@/server/authorization'
import { AppConfigurationErrorState } from '@/app/app/_components/AppConfigurationErrorState'
import { AppShellLoadingFallback, ChatRouteSkeleton } from '@/app/app/_components/AppRouteSkeletons'
import { getSelectedIntegrationProviderId } from '@/server/integrations'
import { WorkspaceAppBoundary } from '@/features/workspaces/components/WorkspaceAppBoundary'
import { WorkspaceScopedContentBoundary } from '@/features/workspaces/components/WorkspaceScopedContentBoundary'
import { AppBreadcrumbProvider } from '@/components/layout/AppBreadcrumbProvider'
import { CollaborationRealtimeProvider } from '@/features/chat/components/collaboration/CollaborationRealtimeProvider'

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

async function AppShellContent({
  children,
  suppressGuestPrompts,
}: {
  children: React.ReactNode
  suppressGuestPrompts: boolean
}) {
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
      await ensureDefaultUserRole(session.user.id)
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
      <DesktopProvider><WorkspaceAppBoundary hasAuthenticatedUser={Boolean(user)}>
        <GatewayModelCatalogPrefetch />
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
                    <GuestGateProvider suppressPrompts={suppressGuestPrompts}>
                        <OnboardingShell sidebar={<AppShellSidebar />}>
                          <Suspense fallback={<AppMainFallback />}>
                            <WorkspaceScopedContentBoundary fallback={<WorkspaceSwitchFallback />}>
                              <AppBreadcrumbProvider><AuthorizationRouteGuard>{children}</AuthorizationRouteGuard></AppBreadcrumbProvider>
                            </WorkspaceScopedContentBoundary>
                          </Suspense>
                        </OnboardingShell>
                    </GuestGateProvider>
                  </AuthorizationProvider>
                </CollaborationRealtimeProvider>
              </CapabilitiesProvider>
            </NavigationProgressProvider>
          </AsyncSessionsProvider>
        </div>
      </WorkspaceAppBoundary></DesktopProvider>
    </AppClientProviders>
  )
}

export function AppShellLayout({
  children,
  suppressGuestPrompts = false,
}: {
  children: React.ReactNode
  suppressGuestPrompts?: boolean
}) {
  return (
    <Suspense fallback={<AppShellLoadingFallback />}>
      <AppShellContent
        suppressGuestPrompts={suppressGuestPrompts}
      >
        {children}
      </AppShellContent>
    </Suspense>
  )
}
