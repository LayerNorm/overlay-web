import { Component, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { installFakeFetch } from './fixtures/fetch'
import { installFixtures, MOCK_USER } from './fixtures/data'

// The API client binds fetch when it loads, so the fakes go in before any app module.
installFakeFetch()
installFixtures()

const params = new URLSearchParams(globalThis.location.search)
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark'

class RouteErrorBoundary extends Component<{ children: ReactNode; route: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(previous: { route: string }) {
    if (previous.route !== this.props.route && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return <pre data-mockup-error style={{ padding: 24, whiteSpace: 'pre-wrap', color: 'crimson', fontSize: 12 }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
  }
}

async function main() {
  const [
    { AppClientProviders },
    { DesktopProvider },
    { WorkspaceAppBoundary },
    { PersonalChatProvider },
    { AsyncSessionsProvider },
    { NavigationProgressProvider, NavigationProgressBar },
    { CapabilitiesProvider },
    { CollaborationRealtimeProvider },
    { AuthorizationProvider },
    { GuestGateProvider },
    { OnboardingShell },
    { AppShellSidebar },
    { WorkspaceScopedContentBoundary },
    { AppBreadcrumbProvider },
    { AuthorizationRouteGuard },
    { ChatFilesHostProvider },
    { RouteOutlet },
    { DEFAULT_OVERLAY_CAPABILITIES },
  ] = await Promise.all([
    import('@/components/providers/AppClientProviders'),
    import('@/components/desktop/DesktopProvider'),
    import('@/features/workspaces/components/WorkspaceAppBoundary'),
    import('@/components/providers/PersonalChatProvider'),
    import('@/components/providers/async-sessions-store'),
    import('@/components/providers/navigation-progress'),
    import('@/components/providers/CapabilitiesProvider'),
    import('@/features/chat/components/collaboration/CollaborationRealtimeProvider'),
    import('@/components/providers/AuthorizationProvider'),
    import('@/components/providers/GuestGateProvider'),
    import('@/app/_components/onboarding/OnboardingShell'),
    import('@/app/app/_components/AppShellSidebar'),
    import('@/features/workspaces/components/WorkspaceScopedContentBoundary'),
    import('@/components/layout/AppBreadcrumbProvider'),
    import('@/components/providers/AuthorizationRouteGuard'),
    import('@/components/providers/ChatFilesHostProvider'),
    import('./routes'),
    import('@overlay/app-core'),
  ])

  const capabilities = {
    ...DEFAULT_OVERLAY_CAPABILITIES,
    work: true,
    computers: true,
    connectedAgents: true,
    externalAgents: true,
    analytics: false,
    errorReporting: false,
  }
  const authorization = { capabilities: [], enforcementMode: 'observe' as const, isDeploymentOwner: true }

  createRoot(document.getElementById('root')!).render(
    <AppClientProviders initialUser={MOCK_USER}>
      <DesktopProvider><WorkspaceAppBoundary hasAuthenticatedUser>
        <PersonalChatProvider>
          <div data-app-shell className="flex h-screen overflow-hidden bg-background text-foreground">
            <AsyncSessionsProvider>
              <NavigationProgressProvider>
                <NavigationProgressBar />
                <CapabilitiesProvider initialCapabilities={capabilities} initialIntegrationProvider="composio">
                  <CollaborationRealtimeProvider>
                    <AuthorizationProvider authorization={authorization}>
                      <GuestGateProvider suppressPrompts>
                        <OnboardingShell sidebar={<AppShellSidebar />}>
                          <Suspense fallback={null}>
                            <WorkspaceScopedContentBoundary fallback={null}>
                              <AppBreadcrumbProvider><AuthorizationRouteGuard><ChatFilesHostProvider>
                                <RouteOutlet ErrorBoundary={RouteErrorBoundary} />
                              </ChatFilesHostProvider></AuthorizationRouteGuard></AppBreadcrumbProvider>
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
        </PersonalChatProvider>
      </WorkspaceAppBoundary></DesktopProvider>
    </AppClientProviders>,
  )
}
void main()
