'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, Loader2, UsersRound } from 'lucide-react'
import type { WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { buildWorkspaceHref } from '../../lib/workspace-routing'

export function AcceptWorkspaceInvitation({
  invitationId,
}: {
  invitationId: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'accepting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)

  async function accept() {
    setStatus('accepting')
    setError(null)
    setRequiresSignIn(false)
    try {
      const response = await fetch(
        `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`,
        {
          method: 'POST',
          credentials: 'same-origin',
        },
      )
      const body = await response.json().catch(() => ({})) as Partial<
        WorkspaceInvitationAcceptResponse & { error: string }
      >
      if (!response.ok) {
        if (response.status === 401) setRequiresSignIn(true)
        throw new Error(body.error ?? 'Could not accept this invitation.')
      }
      if (!body.workspace?.id) throw new Error('The invitation response was incomplete.')
      router.replace(buildWorkspaceHref(body.workspace.id, '/app/chat'))
      router.refresh()
    } catch (acceptError) {
      setStatus('error')
      setError(acceptError instanceof Error ? acceptError.message : 'Could not accept this invitation.')
    }
  }

  const redirect = `/app/invitations/${encodeURIComponent(invitationId)}`

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-7 text-center shadow-sm">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]">
          <UsersRound size={21} />
        </span>
        <h1 className="mt-5 text-lg font-semibold text-[var(--foreground)]">
          Join an Overlay workspace
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
          Invitations are bound to the exact invited email address. Sign in with that account,
          then accept to join.
        </p>
        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-left text-xs text-red-500"
          >
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="relative z-10 mt-6 flex justify-center gap-2">
          {requiresSignIn ? (
            <Link
              href={`/auth/sign-in?redirect=${encodeURIComponent(redirect)}`}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
            >
              Sign in to continue
            </Link>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={status === 'accepting'}
              onClick={() => void accept()}
              data-testid="accept-workspace-invitation"
            >
              {status === 'accepting' ? <Loader2 size={14} className="animate-spin" /> : null}
              Accept invitation
            </Button>
          )}
        </div>
        <p className="mt-5 text-[11px] text-[var(--muted-light)]">
          Expired, cancelled, replaced, or already-used invitations cannot be accepted.
        </p>
      </section>
    </div>
  )
}
