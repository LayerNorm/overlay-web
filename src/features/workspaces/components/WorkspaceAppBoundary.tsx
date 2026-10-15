'use client'

import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import type { WorkspaceClient } from '@/shared/workspaces/types'
import { workspaceClient } from '../lib/workspace-client'
import { useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { AppBootLoader } from '@/components/layout/AppBootLoader'

function WorkspaceHydrationBoundary({ children }: { children: ReactNode }) {
  const { status, error, refresh } = useWorkspace()
  const { isLoading: authLoading, user } = useAuth()
  const [hasShownApp, setHasShownApp] = useState(status === 'ready')
  if (status === 'ready' && !hasShownApp) {
    setHasShownApp(true)
  }
  // 'idle' is only decided once the auth check resolves: a sessionless first
  // paint renders this layout before the client finds the session cookie, so
  // children must stay gated until status is genuinely 'ready' (guests settle
  // at 'idle' with auth done and no user, which still falls through below).
  const undecided =
    status === 'loading' || (status === 'idle' && (authLoading || Boolean(user)))
  if (undecided && !hasShownApp) {
    // Same screen as the boot loader, rendered already-settled so the handoff
    // shows no second splash.
    return <AppBootLoader settled />
  }
  if (status === 'error') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-(--background) p-6">
        <div className="max-w-sm text-center">
          <CircleAlert size={26} className="mx-auto text-(--muted-light)" />
          <h1 className="mt-4 text-sm font-semibold text-(--foreground)">Workspace unavailable</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-(--muted)">
            {error ?? 'Workspace not found or you no longer have access.'}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 h-8 rounded-md border border-(--border) bg-(--surface-subtle) px-3 text-xs font-medium text-(--foreground)"
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
  publicShowcase: forcedPublicShowcase = false,
  showcaseClient,
}: {
  children: ReactNode
  hasAuthenticatedUser: boolean
  publicShowcase?: boolean
  /** Composed by the app layer so this feature never imports showcase. */
  showcaseClient?: WorkspaceClient
}) {
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const publicShowcase = forcedPublicShowcase || searchParams?.get('showcase') === '1'
  // Cache Components can first paint this layout without a session. The client
  // auth check still finds the cookie, so enable workspaces from that too.
  const enabled = hasAuthenticatedUser || publicShowcase || Boolean(user)

  return (
    <WorkspaceProvider
      enabled={enabled}
      client={publicShowcase && showcaseClient ? showcaseClient : workspaceClient}
    >
      <WorkspaceHydrationBoundary>{children}</WorkspaceHydrationBoundary>
    </WorkspaceProvider>
  )
}
