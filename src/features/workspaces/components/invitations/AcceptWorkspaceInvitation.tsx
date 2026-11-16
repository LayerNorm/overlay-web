'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { WorkspaceInvitationAcceptResponse, WorkspaceInvitationPreviewResponse } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { useAuth } from '@/contexts/AuthContext'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'

const unavailableCopy = {
  expired: 'This invitation has expired',
  cancelled: 'This invitation was cancelled',
  accepted: 'This invitation has already been used',
  replaced: 'A newer invitation was sent. Use the latest email.',
} as const

export function AcceptWorkspaceInvitation({ invitationId }: { invitationId: string }) {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const [loaded, setLoaded] = useState<{ id: string; preview?: WorkspaceInvitationPreviewResponse; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = loaded?.id === invitationId ? loaded.preview : undefined
  const loadError = loaded?.id === invitationId ? loaded.error : undefined
  const invitePath = `/app/invitations/${encodeURIComponent(invitationId)}`
  const signInHref = `/auth/sign-in?redirect=${encodeURIComponent(invitePath)}`

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const response = await fetch(`/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 404 ? 'Invitation not found' : 'Could not load this invitation. Please try again.')
      const data = await response.json() as WorkspaceInvitationPreviewResponse
      if (!controller.signal.aborted) setLoaded({ id: invitationId, preview: data })
    })().catch(value => {
      if (!controller.signal.aborted) setLoaded({ id: invitationId, error: value instanceof Error ? value.message : 'Could not load this invitation.' })
    })
    return () => controller.abort()
  }, [invitationId])

  async function accept() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`, { method: 'POST', credentials: 'same-origin' })
      const body = await response.json().catch(() => ({})) as Partial<WorkspaceInvitationAcceptResponse & { error: string }>
      if (response.status === 401) { window.location.assign(signInHref); return }
      if (!response.ok) throw new Error(body.error ?? 'Could not accept this invitation.')
      if (!body.workspace?.id) throw new Error('The invitation response was incomplete.')
      router.replace(buildWorkspaceHref(body.workspace.id, '/app/chat'))
      router.refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not accept this invitation.')
    } finally {
      setBusy(false)
    }
  }

  async function switchAccount() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' })
      if (!response.ok) throw new Error('Could not sign out. Please try again.')
      window.location.assign(signInHref)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not switch accounts.')
      setBusy(false)
    }
  }

  return <InvitationPreviewCard preview={preview} loadError={loadError} authLoading={authLoading} userEmail={user?.email} signedIn={Boolean(user)} busy={busy} error={error} accept={accept} switchAccount={switchAccount} invitePath={invitePath} signInHref={signInHref} />
}

export function InvitationPreviewCard({ preview, loadError, authLoading, userEmail, signedIn, busy, error, accept, switchAccount, invitePath, signInHref }: {
  preview?: WorkspaceInvitationPreviewResponse
  loadError?: string
  authLoading: boolean
  userEmail?: string
  signedIn: boolean
  busy: boolean
  error: string | null
  accept(): Promise<void>
  switchAccount(): Promise<void>
  invitePath: string
  signInHref: string
}) {
  const pending = preview?.status === 'pending'
  const matches = Boolean(userEmail && preview && userEmail.trim().toLowerCase() === preview.invitedEmail.trim().toLowerCase())
  const initials = preview?.workspaceName.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()

  return <div className="flex min-h-dvh w-full flex-col bg-(--background) text-(--foreground)">
    <header className="flex h-14 shrink-0 items-center px-6"><BrandLockup /></header>
    <main className="grid flex-1 place-items-center px-4 pt-6 pb-16">
      <div className="w-full max-w-[420px] text-center">
        <section className="rounded-2xl bg-(--surface-elevated) px-5 py-8 sm:px-7" aria-labelledby="invitation-title">
          {preview ? <>
            <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-(--surface-subtle) text-base font-medium" aria-hidden>{initials}</div>
            <h1 id="invitation-title" className="text-2xl font-medium tracking-[-0.6px]">Join {preview.workspaceName}</h1>
            <p className="mt-2 text-[13px] text-(--muted)">{preview.inviterName ?? 'Someone'} invited you as {preview.role === 'admin' ? 'an' : 'a'} {preview.role}.</p>
            <p className="my-[18px] break-words text-[13px]">{preview.invitedEmail}</p>
            {!pending ? <p role="status" className="text-sm text-(--muted)">{unavailableCopy[preview.status as keyof typeof unavailableCopy]}</p>
              : authLoading ? <p role="status" className="text-sm text-(--muted)">Checking your account...</p>
              : !signedIn ? <div className="flex flex-col gap-2">
                <Button variant="primary" asChild><Link href={`/auth/sign-up?redirect=${encodeURIComponent(invitePath)}&email=${encodeURIComponent(preview.invitedEmail)}`}>Create account<ArrowRight size={14} /></Link></Button>
                <Button variant="ghost" asChild><Link href={signInHref}>I already have an account</Link></Button>
              </div>
              : matches ? <Button className="w-full" variant="primary" disabled={busy} onClick={() => void accept()}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}Accept and continue<ArrowRight size={14} /></Button>
              : <><p className="mb-4 text-[13px] leading-relaxed text-(--muted)">This invitation was sent to {preview.invitedEmail}. You&apos;re signed in as {userEmail}.</p><Button className="w-full" variant="primary" disabled={busy} onClick={() => void switchAccount()}>Switch account</Button></>}
            {pending && <p className="mt-[18px] text-xs leading-relaxed text-(--muted)">New to Overlay? You&apos;ll create your account with this email.</p>}
          </> : <><h1 id="invitation-title" className="text-lg font-medium">{loadError ?? 'Loading invitation...'}</h1>{!loadError && <Loader2 className="mx-auto mt-4 size-5 animate-spin text-(--muted)" aria-label="Loading invitation" />}</>}
          {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
        </section>
        {preview && pending && <p className="mt-[14px] px-[18px] text-xs leading-relaxed text-(--muted)">{preview.workspaceBilling === 'paid'
          ? `${preview.workspaceName} is on a paid plan. Tasks use the workspace budget.`
          : preview.role === 'admin'
            ? `${preview.workspaceName} hasn't activated billing yet. You can subscribe during setup.`
            : `${preview.workspaceName} hasn't activated billing yet. You can set up now and run tasks once an owner or admin subscribes.`}</p>}
      </div>
    </main>
  </div>
}
