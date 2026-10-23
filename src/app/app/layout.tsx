import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AppShellLayout } from '@/app/_components/AppShellLayout'
import { AppShellLoadingFallback } from '@/app/app/_components/AppRouteSkeletons'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildCanonicalWorkspaceRedirectLocation } from '@/shared/workspaces/routing'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

async function WorkspaceRouteLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const handle = requestHeaders.get('x-overlay-workspace-handle')?.trim()
  const session = handle ? await getOverlaySession() : null
  if (session?.user && handle) {
    try {
      const resolution = await getOverlayServerContext().workspaceService.resolveWorkspaceHandle({
        userId: session.user.id,
        handle,
      })
      if (resolution && !resolution.canonical) {
        const pathname = requestHeaders.get('x-overlay-workspace-original-path')
          ?? `/w/${encodeURIComponent(handle)}`
        const search = requestHeaders.get('x-overlay-workspace-original-search') ?? ''
        const location = buildCanonicalWorkspaceRedirectLocation(
          pathname,
          search,
          resolution.canonicalHandle,
        )
        if (location) redirect(location)
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'digest' in error) throw error
    }
  }
  return <AppShellLayout>{children}</AppShellLayout>
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellLoadingFallback />}>
      <WorkspaceRouteLayout>{children}</WorkspaceRouteLayout>
    </Suspense>
  )
}
