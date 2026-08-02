'use client'

import { useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import type {
  WorkspaceManagementItem,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import {
  Button,
  DialogFrame,
  Input,
  Select,
  Textarea,
} from '@overlay/ui/primitives'

export function InviteWorkspaceDialog({
  open,
  guest = false,
  busy,
  error,
  invitePath,
  onOpenChange,
  onInvite,
}: {
  open: boolean
  guest?: boolean
  busy?: boolean
  error?: string | null
  invitePath?: string | null
  onOpenChange(open: boolean): void
  onInvite(input: {
    email: string
    role: Exclude<WorkspaceMembershipRole, 'owner'>
  }): Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<WorkspaceMembershipRole, 'owner'>>(
    guest ? 'guest' : 'member',
  )
  const [copied, setCopied] = useState(false)

  const normalizedEmail = email.trim()
  const canSubmit = normalizedEmail.includes('@') && !busy
  const absoluteInviteUrl = invitePath && typeof window !== 'undefined'
    ? new URL(invitePath, window.location.origin).toString()
    : invitePath

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={guest ? 'Invite a guest' : 'Invite people'}
      description={guest
        ? 'Guests only see resources and rooms explicitly shared with them.'
        : 'Invite someone to collaborate across this workspace.'}
      footer={invitePath ? (
        <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void onInvite({ email: normalizedEmail, role })}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            Send invite
          </Button>
        </>
      )}
    >
      {invitePath ? (
        <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <p className="text-xs font-medium text-[var(--foreground)]">Invitation created</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
            Email delivery is not configured for this deployment. Share this secure link directly.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input
              readOnly
              value={absoluteInviteUrl ?? ''}
              aria-label="Invitation link"
              className="min-w-0 flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                if (!absoluteInviteUrl) return
                void navigator.clipboard.writeText(absoluteInviteUrl).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1_500)
                })
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) void onInvite({ email: normalizedEmail, role })
          }}
        >
          <div>
            <label htmlFor="workspace-invite-email" className="text-xs font-medium text-[var(--foreground)]">
              Email address
            </label>
            <Input
              id="workspace-invite-email"
              autoFocus
              className="mt-2 w-full"
              type="email"
              value={email}
              maxLength={320}
              autoComplete="email"
              placeholder="teammate@company.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {!guest ? (
            <div>
              <label htmlFor="workspace-invite-role" className="text-xs font-medium text-[var(--foreground)]">
                Workspace role
              </label>
              <Select
                id="workspace-invite-role"
                className="mt-2 w-full"
                value={role}
                onChange={(event) => setRole(
                  event.target.value as Exclude<WorkspaceMembershipRole, 'owner'>,
                )}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
          ) : null}
        </form>
      )}
      {error ? <p role="alert" className="mt-3 text-xs text-red-500">{error}</p> : null}
    </DialogFrame>
  )
}

export function CreateTeamDialog({
  open,
  busy,
  error,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onCreate(input: { name: string; description?: string }): Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const normalizedName = name.trim()

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Create a team"
      description="Teams group people and agents for membership and sharing. Teams cannot contain other teams."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!normalizedName || busy}
            onClick={() => void onCreate({
              name: normalizedName,
              ...(description.trim() ? { description: description.trim() } : {}),
            })}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            Create team
          </Button>
        </>
      )}
    >
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (normalizedName && !busy) {
            void onCreate({
              name: normalizedName,
              ...(description.trim() ? { description: description.trim() } : {}),
            })
          }
        }}
      >
        <div>
          <label htmlFor="workspace-team-name" className="text-xs font-medium text-[var(--foreground)]">
            Team name
          </label>
          <Input
            id="workspace-team-name"
            autoFocus
            className="mt-2 w-full"
            value={name}
            maxLength={80}
            placeholder="Research"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="workspace-team-description" className="text-xs font-medium text-[var(--foreground)]">
            Description <span className="font-normal text-[var(--muted-light)]">optional</span>
          </label>
          <Textarea
            id="workspace-team-description"
            className="mt-2 min-h-20"
            value={description}
            maxLength={280}
            placeholder="What this team works on"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </form>
      {error ? <p role="alert" className="mt-3 text-xs text-red-500">{error}</p> : null}
    </DialogFrame>
  )
}

export function TeamMembersDialog({
  open,
  team,
  candidates,
  busyPrincipalId,
  error,
  onOpenChange,
  onToggle,
}: {
  open: boolean
  team: WorkspaceManagementItem | null
  candidates: WorkspaceManagementItem[]
  busyPrincipalId?: string | null
  error?: string | null
  onOpenChange(open: boolean): void
  onToggle(principalId: string, member: boolean): Promise<void>
}) {
  const memberIds = new Set(team?.teamMemberPrincipalIds ?? [])

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={team ? `Manage ${team.name}` : 'Manage team'}
      description="People and named agents can belong to a team. Services and nested teams cannot."
      footer={<Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <div className="mt-5 max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-xl border border-[var(--border)]">
        {candidates.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-[var(--muted)]">
            Invite a person or create a named agent first.
          </p>
        ) : candidates.map((candidate) => {
          const principalId = candidate.principalId
          if (!principalId) return null
          const checked = memberIds.has(principalId)
          const busy = busyPrincipalId === principalId
          return (
            <label
              key={candidate.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[var(--surface-subtle)]"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={Boolean(busyPrincipalId)}
                onChange={() => void onToggle(principalId, !checked)}
                className="h-3.5 w-3.5 accent-[var(--foreground)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-[var(--foreground)]">
                  {candidate.name}
                </span>
                <span className="block truncate text-[10px] capitalize text-[var(--muted-light)]">
                  {candidate.principalType}
                </span>
              </span>
              {busy ? <Loader2 size={13} className="animate-spin text-[var(--muted)]" /> : null}
            </label>
          )
        })}
      </div>
      {error ? <p role="alert" className="mt-3 text-xs text-red-500">{error}</p> : null}
    </DialogFrame>
  )
}

export function ConfirmWorkspaceActionDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  error,
  destructive = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  destructive?: boolean
  onOpenChange(open: boolean): void
  onConfirm(): Promise<void>
}) {
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {error ? <p role="alert" className="mt-4 text-xs text-red-500">{error}</p> : null}
    </DialogFrame>
  )
}
