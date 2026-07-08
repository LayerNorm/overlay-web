import { Suspense } from 'react'
import { getOverlaySession } from '@/server/auth/session'
import { AppShellSidebar } from './_components/AppShellSidebar'
import { AsyncSessionsProvider } from '@/components/providers/async-sessions-store'
import BackgroundPollManager from '@/components/providers/BackgroundPollManager'
import { NavigationProgressProvider, NavigationProgressBar } from '@/components/providers/navigation-progress'
import { GuestGateProvider } from '@/components/providers/GuestGateProvider'
import { OnboardingProvider } from '@/components/providers/OnboardingProvider'
import { CapabilitiesProvider } from '@/components/providers/CapabilitiesProvider'
import { AppClientProviders } from '@/components/providers/AppClientProviders'
import { getAppDataCapabilitiesSync, getOverlayCapabilitiesSync } from '@/server/capabilities'
import { AppConfigurationErrorState } from './_components/AppConfigurationErrorState'
import { AppShellLoadingFallback, ChatRouteSkeleton } from './_components/AppRouteSkeletons'

function AppMainFallback() {
  return <ChatRouteSkeleton />
}

async function AppLayoutContent({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof getOverlaySession>>
  let capabilities: ReturnType<typeof getOverlayCapabilitiesSync>
  let appDataCapabilities: ReturnType<typeof getAppDataCapabilitiesSync>
  try {
    session = await getOverlaySession()
    capabilities = getOverlayCapabilitiesSync()
    appDataCapabilities = getAppDataCapabilitiesSync()
  } catch (error) {
    return <AppConfigurationErrorState error={error} />
  }

  const user = session?.user ?? null

  return (
    <AppClientProviders initialUser={user}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <AsyncSessionsProvider>
          <NavigationProgressProvider>
            <NavigationProgressBar />
            <CapabilitiesProvider
              initialAppDataCapabilities={appDataCapabilities}
              initialCapabilities={capabilities}
            >
              <BackgroundPollManager />
              <GuestGateProvider>
                <OnboardingProvider>
                  <AppShellSidebar />
                  <main className="app-main flex-1 overflow-auto pt-14 transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:pt-0">
                    <Suspense fallback={<AppMainFallback />}>{children}</Suspense>
                  </main>
                </OnboardingProvider>
              </GuestGateProvider>
            </CapabilitiesProvider>
          </NavigationProgressProvider>
        </AsyncSessionsProvider>
      </div>
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
