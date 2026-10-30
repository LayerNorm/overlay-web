'use client'

import { Button } from '@overlay/ui/primitives'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import type { WorkspaceLifecycleStatus } from '@/shared/workspaces/types'
import { workspaceClient } from '../lib/workspace-client'
import { useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { AppBootLoader } from '@/components/layout/AppBootLoader'
import { bootAppShown } from '@/components/layout/boot-loader-state'
import { WorkspaceDirectory } from './WorkspaceDirectory'
import { AcceptWorkspaceInvitation } from './invitations/AcceptWorkspaceInvitation'

function isWorkspaceStatusUndecided(
  status: WorkspaceLifecycleStatus,
  authLoading: boolean,
  hasUser: boolean,
) {
  return status === 'loading' || (status === 'idle' && (authLoading || hasUser))
}

function WorkspaceHydrationBoundary({ children }: { children: ReactNode }) {
  const { status, error, refresh, workspaces } = useWorkspace()
  const pathname = usePathname()
  const { isLoading: authLoading, user } = useAuth()
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const invitationRoute = pathname?.startsWith('/app/invitations/')
  const emptyAccount = status === 'ready' && workspaces.length === 0 && Boolean(user) && !invitationRoute
  if (emptyAccount && !directoryOpen) setDirectoryOpen(true)
  const [hasShownApp, setHasShownApp] = useState(status === 'ready' || bootAppShown.wasShown())
  if (status === 'ready' && !hasShownApp) {
    setHasShownApp(true)
  }
  // 'idle' is only decided once the auth check resolves: a sessionless first
  // paint renders this layout before the client finds the session cookie, so
  // children must stay gated until status is genuinely 'ready' (guests settle
  // at 'idle' with auth done and no user, which still falls through below).
  const undecided = isWorkspaceStatusUndecided(status, authLoading, Boolean(user))
  const gating = undecided && !hasShownApp
  useEffect(() => {
    // Once real app content has painted anywhere this boot, the flag keeps
    // remounts (navigation, workspace switches) from ever gating again.
    if (!gating) {
      bootAppShown.markShown()
    }
  })
  if (gating) {
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
          <Button variant="secondary" size="sm" className="mt-4"
            type="button"
            onClick={() => void refresh()}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }
  if (invitationRoute && pathname) {
    return <AcceptWorkspaceInvitation invitationId={pathname.split('/').at(-1) ?? ''} />
  }
  if (user && (emptyAccount || directoryOpen || pathname === '/app/workspaces')) {
    return <WorkspaceDirectory onOpen={() => setDirectoryOpen(false)} />
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
  const { user } = useAuth()
  // Cache Components can first paint this layout without a session. The client
  // auth check still finds the cookie, so enable workspaces from that too.
  const enabled = hasAuthenticatedUser || Boolean(user)

  return (
    <WorkspaceProvider enabled={enabled} client={workspaceClient}>
      <WorkspaceHydrationBoundary>{children}</WorkspaceHydrationBoundary>
    </WorkspaceProvider>
  )
}
