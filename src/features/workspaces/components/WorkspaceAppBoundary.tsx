'use client'

import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleAlert, Loader2 } from 'lucide-react'
import { createShowcaseWorkspaceClient } from '@/features/showcase/showcase-workspace-client'
import { SHOWCASE_WORKSPACES } from '@/features/showcase/showcase-data'
import { workspaceClient } from '../lib/workspace-client'
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider'

function WorkspaceHydrationBoundary({ children }: { children: ReactNode }) {
  const { status, error, refresh } = useWorkspace()
  if (status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--background)] text-sm text-[var(--muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Opening workspace…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--background)] p-6">
        <div className="max-w-sm text-center">
          <CircleAlert size={26} className="mx-auto text-[var(--muted-light)]" />
          <h1 className="mt-4 text-sm font-semibold text-[var(--foreground)]">Workspace unavailable</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
            {error ?? 'Workspace not found or you no longer have access.'}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 h-8 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs font-medium text-[var(--foreground)]"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
  return children
}

export function WorkspaceAppBoundary({
  children,
  hasAuthenticatedUser,
}: {
  children: ReactNode
  hasAuthenticatedUser: boolean
}) {
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'
  const showcaseClient = useMemo(
    () => createShowcaseWorkspaceClient(SHOWCASE_WORKSPACES),
    [],
  )

  return (
    <WorkspaceProvider
      enabled={hasAuthenticatedUser || publicShowcase}
      client={publicShowcase ? showcaseClient : workspaceClient}
    >
      <WorkspaceHydrationBoundary>{children}</WorkspaceHydrationBoundary>
    </WorkspaceProvider>
  )
}
