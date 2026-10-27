'use client'

import { identityInitials } from '@/shared/workspaces/identity-initials'

import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage, Button, Input, Label, toast } from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { WorkspaceAvatar } from '@/components/identity/WorkspaceAvatar'
import { IdentityImageEditor, type IdentityImageChoice } from '@/components/identity/IdentityImageEditor'
import { identityRequest, notifyIdentityUpdated, useIdentityProfile, type IdentityProfile } from '@/hooks/useIdentityProfile'

export function ProfileSettings() {
  const { activeWorkspace } = useWorkspace()
  if (!activeWorkspace) return <p className="text-sm text-muted-foreground">Select a workspace to edit your profile.</p>
  return <section className="mx-auto w-full max-w-[460px] py-6">
    <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
    <p className="mt-2 text-sm text-muted-foreground">How you appear in this workspace.</p>
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><WorkspaceAvatar workspace={activeWorkspace} size="sm" />{activeWorkspace.name}</div>
    <WorkspaceProfile key={activeWorkspace.id} workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.name} />
  </section>
}

function WorkspaceProfile({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const endpoint = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/profile`
  const { profile, error, loading, reload, setProfile } = useIdentityProfile(endpoint)
  if (!profile) return <div className="py-8 text-sm text-muted-foreground" role="status">{loading ? 'Loading your profile...' : <><p role="alert">{error}</p><Button variant="ghost" onClick={() => void reload()}>Try again</Button></>}</div>
  return <ProfileForm profile={profile} workspaceName={workspaceName} endpoint={endpoint} onSaved={(next) => { setProfile(next); notifyIdentityUpdated(workspaceId) }} />
}

function ProfileForm({ profile, workspaceName, endpoint, onSaved }: { profile: IdentityProfile; workspaceName: string; endpoint: string; onSaved(profile: IdentityProfile): void }) {
  const [name, setName] = useState(profile.displayNameOverride ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingPhoto, setEditingPhoto] = useState(false)
  const initials = identityInitials(name.trim() || profile.displayName)

  async function save(reset = false) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await identityRequest<IdentityProfile>(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: reset ? null : name.trim() || null, ...(reset ? { resetPhoto: true } : {}) }) })
      onSaved(next)
      setName(next.displayNameOverride ?? '')
      toast.success(reset ? 'Using account defaults.' : 'Profile saved.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save your profile.') }
    finally { setBusy(false) }
  }

  async function savePhoto(choice: IdentityImageChoice) {
    let next: IdentityProfile
    if ('file' in choice) {
      const body = new FormData()
      body.append('file', choice.file)
      next = await identityRequest(`${endpoint}/photo`, { method: 'POST', body })
    } else {
      next = await identityRequest(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resetPhoto: true }) })
    }
    onSaved(next)
    toast.success('Profile photo saved.')
  }

  return <>
    <div className="my-9 flex items-center gap-5">
      <Avatar className="size-19"><AvatarImage src={profile.photoUrl ?? undefined} alt="" /><AvatarFallback>{initials}</AvatarFallback></Avatar>
      <div className="space-y-2"><p className="text-sm font-medium">Profile photo</p><p className="text-xs text-muted-foreground">{profile.hasCustomPhoto ? 'Only in this workspace.' : 'Using your account photo.'}</p><Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditingPhoto(true)}>Change photo</Button></div>
    </div>
    <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="space-y-2"><Label htmlFor="workspace-display-name">Display name</Label><Input id="workspace-display-name" maxLength={80} value={name} disabled={busy} placeholder={profile.accountDisplayName ?? profile.displayName} onChange={(event) => setName(event.target.value)} /><p className="text-xs text-muted-foreground">Leave blank to use your account name.</p></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void save(true)}>Use account defaults</Button></div>
    </form>
    <div className="mt-9 rounded-xl bg-(--surface-subtle) p-5"><p className="mb-4 text-xs text-muted-foreground">Visible to people in {workspaceName}</p><div className="flex gap-3"><Avatar className="size-9"><AvatarImage src={profile.photoUrl ?? undefined} alt="" /><AvatarFallback>{initials}</AvatarFallback></Avatar><div><p className="text-sm">{name.trim() || profile.accountDisplayName || profile.displayName}<span className="ml-3 text-xs text-muted-foreground">Now</span></p><p className="mt-3 text-sm text-muted-foreground">Ready when you are.</p></div></div></div>
    <IdentityImageEditor open={editingPhoto} onOpenChange={setEditingPhoto} title="Profile photo" photoUrl={profile.photoUrl} fallback={initials} resetLabel="Use account photo" onSave={savePhoto} />
  </>
}
