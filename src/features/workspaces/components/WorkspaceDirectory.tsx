'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, Plus } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import type { WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { fetchWithSessionRecovery } from '@/shared/auth/session-fetch'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { workspaceMemberLabel } from '@/shared/workspaces/solo-workspace'
import { WorkspaceAvatar } from '@/components/identity/WorkspaceAvatar'

export function WorkspaceDirectory({ onOpen }: { onOpen(): void }) {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { workspaces, invitations = [], createWorkspace, switchWorkspace, refresh } = useWorkspace()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const working = useRef(false)
  const creation = useRef<{ name: string; key: string; workspaceId?: string } | null>(null)

  async function perform(key: string, operation: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(key)
    setError(null)
    try {
      await operation()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not open this workspace. Please try again.')
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  async function open(workspaceId: string) {
    await switchWorkspace(workspaceId)
    router.push(buildWorkspaceHref(workspaceId, '/app/work'))
    onOpen()
  }

  function create() {
    const value = name.trim()
    if (!value || value.length > 80) {
      setError('Give your workspace a name, up to 80 characters.')
      return
    }
    void perform('create', async () => {
      if (creation.current?.name !== value) creation.current = { name: value, key: crypto.randomUUID() }
      const request = creation.current
      if (!request.workspaceId) {
        const workspace = await createWorkspace({ name: value }, { idempotencyKey: request.key })
        request.workspaceId = workspace.id
      }
      await open(request.workspaceId)
    })
  }

  function accept(invitationId: string) {
    void perform(invitationId, async () => {
      const response = await fetchWithSessionRecovery(`/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'idempotency-key': `accept-invitation:${invitationId}` },
      })
      const body = await response.json() as Partial<WorkspaceInvitationAcceptResponse> & { error?: string }
      if (!response.ok || !body.workspace?.id) throw new Error(body.error ?? 'Could not accept this invitation.')
      await refresh()
      router.push(buildWorkspaceHref(body.workspace.id, '/app/work'))
      onOpen()
    })
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <BrandLockup className="text-2xl" />
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden max-w-64 truncate sm:block">{user?.email}</span>
          <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-6 pb-20 pt-[12vh] sm:pt-[15vh]">
        {creating ? (
          <section aria-labelledby="create-workspace-heading">
            <Button variant="ghost" size="sm" className="mb-7 -ml-3 text-muted-foreground" disabled={Boolean(busy)} onClick={() => { setCreating(false); setError(null) }}><ArrowLeft className="size-4" />Workspaces</Button>
            <h1 id="create-workspace-heading" className="text-3xl font-medium tracking-tight">A place for your work.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Give your workspace a name. You can change it later.</p>
            <form className="mt-9 space-y-5" onSubmit={(event) => { event.preventDefault(); create() }}>
              <label className="block space-y-2 text-sm" htmlFor="workspace-name">
                <span>Workspace name</span>
                <Input id="workspace-name" autoFocus value={name} maxLength={80} autoComplete="organization" placeholder="e.g. Acme studio" disabled={Boolean(busy)} onChange={(event) => setName(event.target.value)} className="h-11" />
              </label>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={Boolean(busy) || !name.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Create workspace<ArrowRight className="size-4" /></Button>
            </form>
          </section>
        ) : (
          <section aria-labelledby="workspaces-heading">
            <h1 id="workspaces-heading" className="text-3xl font-medium tracking-tight">Your workspaces.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{workspaces.length ? 'Pick up where you left off, or start something new.' : 'A home for you, your team, and your AI employees.'}</p>
            {workspaces.length ? (
              <div className="mt-8 divide-y divide-border">
                {workspaces.map((workspace) => (
                  <Button key={workspace.id} variant="ghost" className="h-auto w-full justify-start gap-4 rounded-none px-0 py-5 text-left hover:bg-transparent" disabled={Boolean(busy)} onClick={() => void perform(workspace.id, () => open(workspace.id))}>
                    <WorkspaceAvatar workspace={workspace} size="lg" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{workspace.name}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{workspaceMemberLabel(workspace) ?? 'Your workspace'}</span></span>
                    {busy === workspace.id ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 text-muted-foreground" />}
                  </Button>
                ))}
              </div>
            ) : null}
            {invitations.length ? (
              <div className="mt-9 space-y-2">
                <h2 className="mb-3 text-xs font-medium text-muted-foreground">Invitations</h2>
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center gap-3 py-3">
                    <WorkspaceAvatar workspace={{ name: invitation.workspaceName }} size="lg" />
                    <span className="min-w-0 flex-1 truncate text-sm">{invitation.workspaceName}</span>
                    <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => accept(invitation.id)}>{busy === invitation.id ? <Loader2 className="size-4 animate-spin" /> : null}Join</Button>
                  </div>
                ))}
              </div>
            ) : null}
            {error ? <p role="alert" className="mt-5 text-sm text-destructive">{error}</p> : null}
            <Button variant={workspaces.length ? 'ghost' : 'primary'} className="mt-8" disabled={Boolean(busy)} onClick={() => { setCreating(true); setError(null) }}><Plus className="size-4" />Create workspace</Button>
          </section>
        )}
      </main>
    </div>
  )
}
