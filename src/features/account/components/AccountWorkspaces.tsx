'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@overlay/ui/primitives'
import type { AccountWorkspaceDirectoryResponse, WorkspaceCreateResponse, WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import { WorkspaceAvatar } from '@/components/identity/WorkspaceAvatar'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { workspaceMemberLabel } from '@/shared/workspaces/solo-workspace'
import { identityRequest } from '@/hooks/useIdentityProfile'

export function AccountWorkspaces() {
  const router = useRouter()
  const [directory, setDirectory] = useState<AccountWorkspaceDirectoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    try {
      const next = await identityRequest<AccountWorkspaceDirectoryResponse>('/api/v1/account/workspaces')
      if (current === generation.current) { setDirectory(next); setError(null) }
    } catch (caught) { if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Could not load workspaces.') }
  }, [])
  useEffect(() => { void load(); return () => { generation.current += 1 } }, [load])

  async function accept(invitationId: string) {
    if (busy) return
    setBusy(invitationId)
    try {
      const result = await identityRequest<WorkspaceInvitationAcceptResponse>(`/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`, { method: 'POST', headers: { 'idempotency-key': `accept-invitation:${invitationId}` } })
      router.push(buildWorkspaceHref(result.workspace.id, '/app/work'))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not accept the invitation.') }
    finally { setBusy(null) }
  }

  return <section className="mt-4">
    <div className="mb-6 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Workspaces</h2><Button variant="ghost" size="sm" onClick={() => setCreating(true)}><Plus className="size-4" />Create workspace</Button></div>
    {error ? <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="ghost" onClick={() => void load()}>Try again</Button></div> : null}
    {!directory && !error ? <p className="text-sm text-muted-foreground" role="status">Loading workspaces...</p> : null}
    {directory?.workspaces.length === 0 ? <p className="py-4 text-sm text-muted-foreground">You have no workspaces yet.</p> : null}
    <div className="space-y-3">{directory?.workspaces.map((workspace) => <Link key={workspace.id} href={buildWorkspaceHref(workspace.id, '/app/work')} className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-(--surface-subtle) focus-visible:outline-ring">
      <WorkspaceAvatar workspace={workspace} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{workspace.name}</p><p className="mt-1 text-xs text-muted-foreground">{workspaceMemberLabel(workspace)}</p></div>
      <span className="text-xs capitalize text-muted-foreground">{workspace.role}</span><ChevronRight className="size-4 text-muted-foreground" />
    </Link>)}</div>
    {directory?.invitations.length ? <div className="mt-6 space-y-3"><h3 className="text-sm font-medium">Invitations</h3>{directory.invitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-3"><div className="min-w-0 flex-1 text-sm"><p className="truncate">{invitation.workspaceName}</p><p className="text-xs capitalize text-muted-foreground">{invitation.role}</p></div><Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void accept(invitation.id)}>{busy === invitation.id ? 'Joining...' : 'Join'}</Button></div>)}</div> : null}
    <Dialog open={creating} onOpenChange={setCreating}>{creating ? <CreateAccountWorkspace onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); router.push(buildWorkspaceHref(id, '/app/work')) }} /> : null}</Dialog>
  </section>
}

function CreateAccountWorkspace({ onCreated, onCancel }: { onCreated(id: string): void; onCancel(): void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef<{ name: string; key: string } | null>(null)
  async function create() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    if (attempt.current?.name !== trimmed) attempt.current = { name: trimmed, key: crypto.randomUUID() }
    try {
      const next = await identityRequest<WorkspaceCreateResponse>('/api/v1/account/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': attempt.current.key }, body: JSON.stringify({ name: trimmed }) })
      onCreated(next.workspace.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create the workspace.') }
    finally { setBusy(false) }
  }
  return <DialogContent showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onInteractOutside={(event) => { if (busy) event.preventDefault() }}><DialogHeader className="flex-col items-start gap-1 pr-6"><DialogTitle>Create workspace</DialogTitle><DialogDescription>A shared space for your people and agents.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void create() }}><div className="space-y-2"><Label htmlFor="new-workspace-name">Workspace name</Label><Input id="new-workspace-name" value={name} maxLength={80} required disabled={busy} onChange={(event) => setName(event.target.value)} /></div>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" variant="secondary" disabled={busy || !name.trim()}>{busy ? 'Creating...' : 'Create workspace'}</Button></DialogFooter></form></DialogContent>
}
