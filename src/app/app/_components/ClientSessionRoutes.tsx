'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useAuth, type AuthUser } from '@/contexts/AuthContext'
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { AppRouteSessionRecovery } from './AppRouteSessionRecovery'
import { ChatRouteSkeleton } from './AppRouteSkeletons'

/**
 * Signed-in routes render from the session the app shell already resolved
 * (AuthProvider is hydrated with the server session), so switching pages no
 * longer waits on a fresh server session read and its full-page skeleton.
 * A missing session falls back to the same recovery the server gate used.
 */
function useRouteUser(fallback: ReactNode): { user: AuthUser | null; gate: ReactNode | null } {
  const { user, isLoading } = useAuth()
  if (user) return { user, gate: null }
  return { user: null, gate: isLoading ? fallback : <AppRouteSessionRecovery /> }
}

const ChatActivityView = dynamic(
  () => import('@/features/chat/components/ChatActivityView').then((module) => module.ChatActivityView),
  { loading: () => <ChatRouteSkeleton /> },
)
const NotebookEditor = dynamic(() => import('@/features/notebook/components/NotebookEditor'), {
  loading: () => (
    <div className="h-full min-h-[40vh] w-full" aria-busy="true">
      <span className="sr-only">Loading notes</span>
    </div>
  ),
})
const ToolsView = dynamic(() => import('@/features/tools/components/ToolsView'), {
  loading: () => <ChatRouteSkeleton />,
})

export function ChatRouteClient({ mode = 'chat' }: { mode?: 'chat' | 'automate' }) {
  // Chat never required a session to render (signed-out visitors get the sign-in prompt).
  const { user, isLoading } = useAuth()
  if (!user && isLoading) return <ChatRouteSkeleton mode={mode} />
  return <ChatSuspenseBoundary userId={user?.id ?? null} firstName={user?.firstName ?? undefined} mode={mode} />
}

export function ActivityRouteClient() {
  const { gate } = useRouteUser(<ChatRouteSkeleton />)
  return gate ?? <ChatActivityView />
}

export function NotesRouteClient() {
  const { user, gate } = useRouteUser(<ChatRouteSkeleton />)
  return gate ?? <NotebookEditor userId={user!.id} />
}

export function ToolsRouteClient() {
  const { user, gate } = useRouteUser(<ChatRouteSkeleton />)
  return gate ?? <ToolsView userId={user!.id} />
}
