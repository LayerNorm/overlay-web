'use client'

import Link from 'next/link'
import { readWorkspaceRouteDescriptor, readWorkspaceRouteTarget, SCOPED_WORKSPACE_SURFACES } from '@/shared/workspaces/routing'

export function workspaceRouteRequiresSignIn(pathname: string, search: string) {
  const descriptor = readWorkspaceRouteDescriptor(pathname)
  const params = new URLSearchParams(search)
  if (!descriptor || !SCOPED_WORKSPACE_SURFACES.has(descriptor.surface) || params.get('section') === 'account') return false
  if (readWorkspaceRouteTarget(pathname) || descriptor.surface !== 'chat') return true
  return (params.has('id') && params.get('scope') !== 'personal' && params.get('view') !== 'personal')
    || params.get('scope') === 'workspace' || ['dms', 'channels', 'workspace-chats'].includes(params.get('view') ?? '')
}

export function WorkspaceSignInPrompt({ pathname, search }: { pathname: string; search: string }) {
  const redirect = `${pathname}${search ? `?${search}` : ''}`
  return <div className="flex h-full min-h-64 items-center justify-center px-6">
    <div className="text-center">
      <h1 className="text-sm font-semibold text-(--foreground)">Sign in to continue</h1>
      <p className="mt-2 text-sm text-(--muted)">Sign in to open this workspace.</p>
      <Link href={`/auth/sign-in?redirect=${encodeURIComponent(redirect)}`} className="mt-4 inline-flex text-sm font-medium text-(--foreground) underline underline-offset-4">Sign in</Link>
    </div>
  </div>
}
