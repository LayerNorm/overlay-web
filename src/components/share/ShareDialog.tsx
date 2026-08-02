'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Check,
  Copy,
  Globe2,
  Hash,
  Loader2,
  Lock,
  MailPlus,
  Trash2,
  TriangleAlert,
  User,
  Users,
  X,
} from 'lucide-react'
import { usePresence } from '@overlay/ui'
import type {
  WorkspaceResourceGrant,
  WorkspaceShareAccessRole,
  WorkspaceShareDirectoryEntry,
  WorkspaceShareImpact,
  WorkspaceShareResourceType,
} from '@overlay/workspace-contracts'
import type { ShareDialogResource } from '@/shared/share/share-dialog-resource'
import {
  describeTargetInheritance,
  shareRoleOptions,
  SHARE_RESOURCE_LABELS,
} from '@/shared/share/share-access-policy'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { Select } from '@overlay/ui/primitives'

/** A grant or revocation waiting on explicit confirmation of its disclosure. */
type PendingShareChange =
  | { kind: 'grant'; targetKey: string; accessRole: WorkspaceShareAccessRole; impact: WorkspaceShareImpact }
  | { kind: 'revoke'; grant: WorkspaceResourceGrant; impact: WorkspaceShareImpact }

export function ShareDialog({
  isOpen,
  resource,
  onClose,
  workspaceId: activeWorkspaceId = null,
}: {
  isOpen: boolean
  resource: ShareDialogResource | null
  onClose: () => void
  /** Active workspace. Passed in so shared UI stays free of feature context. */
  workspaceId?: string | null
}) {
  const [grants, setGrants] = useState<WorkspaceResourceGrant[]>([])
  const [directory, setDirectory] = useState<WorkspaceShareDirectoryEntry[]>([])
  const [target, setTarget] = useState('')
  const [role, setRole] = useState<WorkspaceShareAccessRole>('viewer')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [canInvite, setCanInvite] = useState(false)
  const [publicLinksEnabled, setPublicLinksEnabled] = useState(true)
  const [pending, setPending] = useState<PendingShareChange | null>(null)
  const resourceType = resource ? canonicalType(resource.type) : null

  useEffect(() => {
    if (!isOpen || !resource?.id || !resourceType || !activeWorkspaceId) return
    let current = true
    void overlayAppClient.sharing.get({
      workspaceId: activeWorkspaceId,
      resourceType,
      resourceId: resource.id,
    }).then((response) => {
      if (!current) return
      setGrants(response.grants)
      setDirectory([
        ...response.directory.principals,
        ...response.directory.teams,
        ...response.directory.rooms,
      ])
      setCanInvite(response.directory.canInvite)
      setPublicLinksEnabled(response.publicLinksEnabled)
      setLoading(false)
      setNotice(null)
    }).catch((error) => {
      if (!current) return
      setNotice(error instanceof Error ? error.message : 'Could not load sharing')
      setLoading(false)
    })
    return () => { current = false }
  }, [activeWorkspaceId, isOpen, resource?.id, resourceType])

  useEffect(() => {
    if (!isOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [isOpen, onClose])

  useEffect(() => { if (!isOpen) setPending(null) }, [isOpen])

  const entriesByKey = useMemo(() => new Map(
    directory.map((entry) => [`${entry.targetType}:${entry.id}`, entry]),
  ), [directory])
  const available = useMemo(() => directory.filter((entry) => !grants.some((grant) => (
    grant.targetType === entry.targetType && grant.targetId === entry.id
  ))), [directory, grants])
  const { mounted, visible } = usePresence(isOpen)
  if (!mounted || !resource || !resourceType) return null

  const shareResource = {
    workspaceId: activeWorkspaceId ?? '',
    resourceType,
    resourceId: resource.id ?? '',
  }

  /**
   * Team and room targets keep growing, so every grant to one is disclosed and
   * confirmed inside the dialog before it exists.
   */
  async function requestGrant() {
    if (!activeWorkspaceId || !resource?.id || !target) return
    const [targetType, ...idParts] = target.split(':')
    const targetId = idParts.join(':')
    if (targetType === 'principal') return await commitGrant(target, role)
    setBusy(true)
    setNotice(null)
    try {
      const { impact } = await overlayAppClient.sharing.impact(shareResource, {
        targetType: targetType as 'team' | 'room',
        targetId,
      })
      setPending({ kind: 'grant', targetKey: target, accessRole: role, impact })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not check who would gain access')
    } finally {
      setBusy(false)
    }
  }

  async function commitGrant(targetKey: string, accessRole: WorkspaceShareAccessRole) {
    if (!activeWorkspaceId || !resource?.id) return
    const [targetType, ...idParts] = targetKey.split(':')
    setBusy(true)
    setNotice(null)
    try {
      const response = await overlayAppClient.sharing.grant(shareResource, {
        targetType: targetType as 'principal' | 'team' | 'room',
        targetId: idParts.join(':'),
        accessRole,
        confirmRoomExpansion: true,
      })
      setGrants((current) => [...current.filter((grant) => grant.id !== response.grant.id), response.grant])
      setTarget('')
      setPending(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not grant access')
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(grant: WorkspaceResourceGrant, accessRole: WorkspaceShareAccessRole) {
    if (!activeWorkspaceId || !resource?.id) return
    setBusy(true)
    try {
      const response = await overlayAppClient.sharing.grant(shareResource, {
        targetType: grant.targetType,
        targetId: grant.targetId,
        accessRole,
        confirmRoomExpansion: true,
      })
      setGrants((current) => current.map((item) => item.id === grant.id ? response.grant : item))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update access')
    } finally {
      setBusy(false)
    }
  }

  async function requestRevoke(grant: WorkspaceResourceGrant) {
    if (!activeWorkspaceId || !resource?.id) return
    setBusy(true)
    setNotice(null)
    try {
      const { impact } = await overlayAppClient.sharing.impact(shareResource, { grantId: grant.id })
      setPending({ kind: 'revoke', grant, impact })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not check who would lose access')
    } finally {
      setBusy(false)
    }
  }

  async function commitRevoke(grant: WorkspaceResourceGrant) {
    if (!activeWorkspaceId || !resource?.id) return
    setBusy(true)
    try {
      await overlayAppClient.sharing.revoke(shareResource, grant.id)
      setGrants((current) => current.filter((item) => item.id !== grant.id))
      setPending(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not remove access')
    } finally {
      setBusy(false)
    }
  }

  async function invite() {
    if (!activeWorkspaceId || !inviteEmail.trim()) return
    setBusy(true)
    try {
      await overlayAppClient.workspaces.invite(activeWorkspaceId, {
        email: inviteEmail.trim(),
        role: 'guest',
      })
      setNotice('Invitation sent. Add them here after they join the workspace.')
      setInviteEmail('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send invitation')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!resource?.url) return
    await navigator.clipboard.writeText(resource.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <div
      className={`fixed inset-0 z-[10080] flex items-center justify-center bg-black/55 p-4 transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className={`w-[min(620px,94vw)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl transition duration-150 ${visible ? 'translate-y-0 scale-100' : 'translate-y-1 scale-[.98]'}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div className="min-w-0">
            <h2 id="share-dialog-title" className="truncate text-lg font-semibold text-[var(--foreground)]">
              Share “{resource.title}”
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">People, agents, teams, and rooms inherit access dynamically.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
            <X size={17} />
          </button>
        </header>

        <ShareDialogContent
          resourceType={resourceType}
          resourceTitle={resource.title}
          hasResourceId={Boolean(resource.id)}
          publicUrl={resource.url}
          publicLinksEnabled={publicLinksEnabled}
          grants={grants}
          entriesByKey={entriesByKey}
          available={available}
          loading={loading}
          busy={busy}
          notice={notice}
          copied={copied}
          canInvite={canInvite}
          inviteEmail={inviteEmail}
          pending={pending}
          target={target}
          role={role}
          onTargetChange={setTarget}
          onRoleChange={setRole}
          onRequestGrant={() => void requestGrant()}
          onChangeRole={(grant, next) => void changeRole(grant, next)}
          onRequestRevoke={(grant) => void requestRevoke(grant)}
          onConfirmPending={() => {
            if (!pending) return
            if (pending.kind === 'grant') void commitGrant(pending.targetKey, pending.accessRole)
            else void commitRevoke(pending.grant)
          }}
          onCancelPending={() => setPending(null)}
          onInviteEmailChange={setInviteEmail}
          onInvite={() => void invite()}
          onCopyLink={() => void copyLink()}
        />
      </div>
    </div>
  )
}

/**
 * Presentational body of the Share dialog. Kept prop-driven so every state —
 * loading, empty, confirmation, policy-disabled links — is renderable in tests.
 */
export function ShareDialogContent({
  resourceType,
  resourceTitle,
  hasResourceId,
  publicUrl,
  publicLinksEnabled,
  grants,
  entriesByKey,
  available,
  loading,
  busy,
  notice,
  copied,
  canInvite,
  inviteEmail,
  pending,
  target,
  role,
  onTargetChange,
  onRoleChange,
  onRequestGrant,
  onChangeRole,
  onRequestRevoke,
  onConfirmPending,
  onCancelPending,
  onInviteEmailChange,
  onInvite,
  onCopyLink,
}: {
  resourceType: WorkspaceShareResourceType
  resourceTitle: string
  hasResourceId: boolean
  publicUrl?: string
  publicLinksEnabled: boolean
  grants: WorkspaceResourceGrant[]
  entriesByKey: Map<string, WorkspaceShareDirectoryEntry>
  available: WorkspaceShareDirectoryEntry[]
  loading: boolean
  busy: boolean
  notice: string | null
  copied: boolean
  canInvite: boolean
  inviteEmail: string
  pending: PendingShareChange | null
  target: string
  role: WorkspaceShareAccessRole
  onTargetChange(value: string): void
  onRoleChange(value: WorkspaceShareAccessRole): void
  onRequestGrant(): void
  onChangeRole(grant: WorkspaceResourceGrant, role: WorkspaceShareAccessRole): void
  onRequestRevoke(grant: WorkspaceResourceGrant): void
  onConfirmPending(): void
  onCancelPending(): void
  onInviteEmailChange(value: string): void
  onInvite(): void
  onCopyLink(): void
}) {
  const roleOptions = shareRoleOptions(resourceType)
  return (
    <div className="max-h-[min(680px,75vh)] overflow-y-auto px-6 py-5">
      {hasResourceId ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
            <Select
              value={target}
              aria-label="Add a person, agent, team, or room"
              onChange={(event) => onTargetChange(event.target.value)}
              className="h-10 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]"
            >
              <option value="">Add a person, agent, team, or room…</option>
              {groups(available).map(({ label, entries }) => entries.length > 0 ? (
                <optgroup key={label} label={label}>
                  {entries.map((entry) => (
                    <option key={`${entry.targetType}:${entry.id}`} value={`${entry.targetType}:${entry.id}`}>{entry.name}</option>
                  ))}
                </optgroup>
              ) : null)}
            </Select>
            <Select
              value={role}
              aria-label="Permission"
              onChange={(event) => onRoleChange(event.target.value as WorkspaceShareAccessRole)}
              className="h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)]"
            >
              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            <button
              type="button"
              disabled={!target || busy}
              onClick={onRequestGrant}
              className="h-10 rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {roleOptions.find((option) => option.value === role)?.description}
          </p>

          {pending ? (
            <section
              data-testid="share-dialog-confirmation"
              className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                <TriangleAlert size={15} className="text-amber-500" />
                {pending.kind === 'grant'
                  ? `Share this ${SHARE_RESOURCE_LABELS[resourceType]} with ${pending.impact.targetName}?`
                  : `Remove ${pending.impact.targetName}’s access?`}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {pending.kind === 'grant'
                  ? `${describeTargetInheritance(pending.impact.targetType)} will be able to open “${resourceTitle}”.`
                  : `Access granted through ${pending.impact.targetName} ends immediately, including open downloads, streams, and agent tool calls.`}
              </p>
              <ImpactList
                label={pending.kind === 'grant' ? 'Gaining access' : 'Losing access'}
                principals={pending.kind === 'grant' ? pending.impact.gaining : pending.impact.losing}
                emptyLabel={pending.kind === 'grant'
                  ? 'Nobody new — everyone here already has access another way'
                  : 'Nobody loses access; every person here keeps it another way'}
              />
              {pending.impact.retaining.length > 0 ? (
                <ImpactList
                  label="Already has access another way"
                  principals={pending.impact.retaining}
                  emptyLabel=""
                />
              ) : null}
              {pending.impact.dynamic ? (
                <p className="mt-3 text-[11px] text-[var(--muted-light)]">
                  This list changes with membership. People and agents added later inherit the same access.
                </p>
              ) : null}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onConfirmPending}
                  className="h-9 rounded-lg bg-[var(--foreground)] px-3 text-xs font-medium text-[var(--background)] disabled:opacity-40"
                >
                  {pending.kind === 'grant' ? 'Share with everyone listed' : 'Remove access'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCancelPending}
                  className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-subtle)] disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Who has access</h3>
            <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]">
              {loading ? (
                <div data-testid="share-dialog-loading" className="flex h-20 items-center justify-center text-[var(--muted)]">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : grants.length === 0 ? (
                <div data-testid="share-dialog-empty" className="px-4 py-5 text-sm text-[var(--muted)]">
                  Only the owner has explicit access.
                </div>
              ) : grants.map((grant) => {
                const entry = entriesByKey.get(`${grant.targetType}:${grant.targetId}`)
                return (
                  <div key={grant.id} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)]">{entryIcon(entry)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{entry?.name ?? 'Unavailable target'}</p>
                      <p className="truncate text-[11px] text-[var(--muted)]">
                        {describeTargetInheritance(grant.targetType)}
                      </p>
                    </div>
                    <Select
                      value={grant.accessRole}
                      aria-label={`Permission for ${entry?.name ?? targetLabel(grant.targetType)}`}
                      disabled={busy}
                      onChange={(event) => onChangeRole(grant, event.target.value as WorkspaceShareAccessRole)}
                      className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
                    >
                      {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRequestRevoke(grant)}
                      aria-label={`Remove access for ${entry?.name ?? targetLabel(grant.targetType)}`}
                      className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      ) : null}

      {canInvite ? (
        <section className="mt-5 rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><MailPlus size={15} /> Invite someone to the workspace</div>
          <div className="mt-3 flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              aria-label="Guest email"
              onChange={(event) => onInviteEmailChange(event.target.value)}
              placeholder="name@company.com"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            />
            <button
              type="button"
              disabled={busy || !inviteEmail.trim()}
              onClick={onInvite}
              className="rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-40"
            >
              Invite as guest
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">General access</h3>
        <div
          data-testid="share-dialog-general-access"
          className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)]">
            {publicLinksEnabled && publicUrl ? <Globe2 size={15} /> : <Lock size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              {!publicLinksEnabled
                ? 'Public links are off for this workspace'
                : publicUrl ? 'Anyone with the link' : 'Restricted'}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              {!publicLinksEnabled
                ? 'An owner or admin can turn public links back on in Workspace settings → Sharing & links.'
                : publicUrl
                  ? 'Public link access is view-only, separate from workspace grants, and redacts attachments that are not public themselves.'
                  : 'Only explicitly granted workspace targets can open this resource.'}
            </p>
          </div>
          {publicLinksEnabled && publicUrl ? (
            <button type="button" onClick={onCopyLink} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs hover:bg-[var(--surface-subtle)]">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          ) : null}
        </div>
      </section>

      {notice ? <p data-testid="share-dialog-notice" className="mt-4 text-xs text-[var(--muted)]">{notice}</p> : null}
    </div>
  )
}

function ImpactList({
  label,
  principals,
  emptyLabel,
}: {
  label: string
  principals: WorkspaceShareImpact['gaining']
  emptyLabel: string
}) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      {principals.length === 0 ? (
        emptyLabel ? <p className="mt-1 text-xs text-[var(--muted)]">{emptyLabel}</p> : null
      ) : (
        <ul className="mt-1 space-y-1">
          {principals.map((principal) => (
            <li key={`${label}:${principal.principalId}`} className="flex items-center gap-2 text-xs text-[var(--foreground)]">
              {principal.kind === 'agent' ? <Bot size={12} /> : <User size={12} />}
              <span className="truncate">{principal.name}</span>
              {principal.via ? <span className="truncate text-[var(--muted)]">via {principal.via}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function canonicalType(type: ShareDialogResource['type']): WorkspaceShareResourceType {
  return type === 'chat' ? 'conversation' : type
}

function groups(entries: WorkspaceShareDirectoryEntry[]) {
  return [
    { label: 'People & agents', entries: entries.filter((entry) => entry.targetType === 'principal') },
    { label: 'Teams', entries: entries.filter((entry) => entry.targetType === 'team') },
    { label: 'Rooms', entries: entries.filter((entry) => entry.targetType === 'room') },
  ]
}

function entryIcon(entry: WorkspaceShareDirectoryEntry | undefined) {
  if (entry?.kind === 'agent') return <Bot size={14} />
  if (entry?.kind === 'team' || entry?.kind === 'dm') return <Users size={14} />
  if (entry?.kind === 'channel') return <Hash size={14} />
  return <User size={14} />
}

function targetLabel(type: WorkspaceResourceGrant['targetType']) {
  return type === 'principal' ? 'Workspace member' : type === 'team' ? 'Team' : 'Room'
}
