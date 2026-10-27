'use client'

import { identityInitials } from '@/shared/workspaces/identity-initials'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, toast } from '@overlay/ui/primitives'
import { IdentityImageEditor, type IdentityImageChoice } from '@/components/identity/IdentityImageEditor'
import { identityRequest, notifyIdentityUpdated, useIdentityProfile, type IdentityProfile } from '@/hooks/useIdentityProfile'

export function AccountIdentity() {
  const endpoint = '/api/v1/account/profile'
  const { profile, error, loading, reload, setProfile } = useIdentityProfile(endpoint)
  const [editingPhoto, setEditingPhoto] = useState(false)
  const [editingName, setEditingName] = useState(false)

  async function savePhoto(choice: IdentityImageChoice) {
    let next: IdentityProfile
    if ('file' in choice) {
      const body = new FormData()
      body.append('file', choice.file)
      next = await identityRequest(`${endpoint}/photo`, { method: 'POST', body })
    } else {
      next = await identityRequest(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resetPhoto: true }) })
    }
    setProfile(next)
    notifyIdentityUpdated()
    toast.success('Account photo saved.')
  }

  if (!profile) return <div className="py-8 text-sm text-muted-foreground" role="status">{loading ? 'Loading your profile...' : <><p role="alert">{error}</p><Button variant="ghost" onClick={() => void reload()}>Try again</Button></>}</div>
  return <>
    <div className="flex items-center gap-3 py-8">
      <Button variant="ghost" className="relative size-15 shrink-0 rounded-full p-0" onClick={() => setEditingPhoto(true)} aria-label="Change account photo">
        <Avatar className="size-15"><AvatarImage src={profile.photoUrl ?? undefined} alt="" /><AvatarFallback>{identityInitials(profile.displayName)}</AvatarFallback></Avatar>
        <span className="absolute -bottom-1 right-0 rounded-full border border-(--border) bg-background p-1 shadow-sm"><Pencil className="size-3" /></span>
      </Button>
      <div className="min-w-0 flex-1"><p className="truncate text-lg font-medium">{profile.displayName}</p><p className="truncate text-sm text-muted-foreground">{profile.email}</p></div>
      <Button variant="ghost" size="sm" onClick={() => setEditingName(true)}>Edit</Button>
    </div>
    <IdentityImageEditor open={editingPhoto} onOpenChange={setEditingPhoto} title="Account photo" photoUrl={profile.photoUrl} fallback={identityInitials(profile.displayName)} resetLabel="Use sign-in photo" onSave={savePhoto} />
    <Dialog open={editingName} onOpenChange={setEditingName}>{editingName ? <AccountNameEditor profile={profile} onCancel={() => setEditingName(false)} onSave={async (displayName) => {
      const next = await identityRequest<IdentityProfile>(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) })
      setProfile(next)
      notifyIdentityUpdated()
      setEditingName(false)
      toast.success('Account name saved.')
    }} /> : null}</Dialog>
  </>
}

function AccountNameEditor({ profile, onSave, onCancel }: { profile: IdentityProfile; onSave(name: string | null): Promise<void>; onCancel(): void }) {
  const [name, setName] = useState(profile.displayNameOverride ?? profile.displayName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <DialogContent showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onInteractOutside={(event) => { if (busy) event.preventDefault() }}><DialogHeader className="flex-col items-start gap-1 pr-6"><DialogTitle>Account name</DialogTitle><DialogDescription>Your default name across Overlay.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      void onSave(name.trim() || null).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not save your name.')).finally(() => setBusy(false))
    }}>
      <div className="space-y-2"><Label htmlFor="account-name">Name</Label><Input id="account-name" value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></DialogFooter>
    </form>
  </DialogContent>
}
