'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, Plus, Unlink } from 'lucide-react'
import type {
  WorkspaceManagementItem,
  WorkspacePlatformIdentity,
  WorkspacePlatformInstallationSummary,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { workspaceManagementClient } from '@/features/workspaces/lib/workspace-client'

const DIRECTORY_OPTIONS = [
  { value: 'slack', label: 'Slack' },
  { value: 'msteams', label: 'MS Teams' },
]

/**
 * Connected-chat settings: Slack workspace installs plus manual
 * admin-gated identity linking (Slack user id ↔ workspace member).
 * Managers only — everyone else sees an explanatory note.
 */
export function ConnectedChatSettings({ showcase = false }: { showcase?: boolean }) {
  const { activeWorkspaceId } = useWorkspace()
  return <ConnectedChatSettingsBody workspaceId={activeWorkspaceId} showcase={showcase} />
}

export function ConnectedChatSettingsBody({ workspaceId: activeWorkspaceId, showcase = false }: {
  workspaceId: string | null
  showcase?: boolean
}) {
  const [installations, setInstallations] = useState<WorkspacePlatformInstallationSummary[]>([])
  const [identities, setIdentities] = useState<WorkspacePlatformIdentity[]>([])
  const [members, setMembers] = useState<WorkspaceManagementItem[]>([])
  const [canManage, setCanManage] = useState(showcase)
  const [loading, setLoading] = useState(!showcase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [principalId, setPrincipalId] = useState('')
  const [directory, setDirectory] = useState('slack')
  const [externalId, setExternalId] = useState('')

  const load = useCallback(async () => {
    if (showcase || !activeWorkspaceId) return
    setLoading(true)
    setError(null)
    try {
      const [installResult, identityResult, peopleResult] = await Promise.all([
        overlayAppClient.slack.listInstallations(activeWorkspaceId, { cache: 'no-store' }),
        overlayAppClient.slack.listIdentities(activeWorkspaceId, { cache: 'no-store' }),
        workspaceManagementClient.load(activeWorkspaceId, 'people'),
      ])
      setInstallations(installResult.installations)
      setIdentities(identityResult.identities)
      setMembers(peopleResult.items.filter((item) => item.kind === 'member'))
      setCanManage(true)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load connected chat.'
      // Non-managers are rejected by the manager-gated endpoints.
      if (/forbidden|manager|not permitted/i.test(message)) {
        setCanManage(false)
        setError(null)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, showcase])

  useEffect(() => { void load() }, [load])

  async function connectSlack() {
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      const { authorizeUrl } = await overlayAppClient.slack.startInstall(activeWorkspaceId)
      window.location.href = authorizeUrl
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Could not start the Slack install.')
      setBusy(false)
    }
  }

  async function linkIdentity() {
    if (!activeWorkspaceId || !principalId || !externalId.trim()) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.slack.linkIdentity(activeWorkspaceId, {
        principalId,
        directory,
        externalId: externalId.trim(),
      })
      setPrincipalId('')
      setExternalId('')
      await load()
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Could not link identity.')
    } finally {
      setBusy(false)
    }
  }

  async function unlinkIdentity(identity: WorkspacePlatformIdentity) {
    if (!activeWorkspaceId) return
    const label = identity.platformDisplayName ?? identity.externalId
    if (!window.confirm(`Unlink ${label}? They will no longer reach agents from connected chat. Their workspace membership is unchanged.`)) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.slack.unlinkIdentity(activeWorkspaceId, {
        directory: identity.directory,
        externalId: identity.externalId,
      })
      await load()
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : 'Could not unlink identity.')
    } finally {
      setBusy(false)
    }
  }

  if (showcase) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6">
        <section>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Connected chat</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Answer workspace agents from Slack and MS Teams. Sign in to connect a workspace.
            </p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6">
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Connected chat</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Answer workspace agents from Slack and MS Teams. Only workspace managers can connect
            workspaces and link identities.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading connected chat…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-500">{error}</p>
        ) : !canManage ? (
          <p className="text-sm text-[var(--muted)]">Only workspace owners and admins can manage connected chat.</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-xs font-medium text-[var(--foreground)]">Connected workspaces</h3>
              {installations.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No chat workspaces connected yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                  {installations.map((install) => (
                    <li key={`${install.directory}:${install.externalTeamId}`} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <Link2 size={14} className="shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                        {install.teamName ?? install.externalTeamId}
                        <span className="ml-2 text-xs text-[var(--muted)]">{install.directory} · {install.externalTeamId}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void connectSlack()}
                className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium text-[var(--foreground)] disabled:opacity-50"
              >
                <Plus size={15} /> Connect Slack workspace
              </button>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium text-[var(--foreground)]">Linked identities</h3>
              {identities.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No chat identities linked yet. Link a member below.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                  {identities.map((identity) => (
                    <li key={`${identity.directory}:${identity.externalId}`} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                        {identity.platformDisplayName ?? identity.externalId}
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {identity.directory} · {identity.externalId} → {identity.principalDisplayName ?? identity.principalId}
                        </span>
                      </span>
                      {identity.status === 'active' ? (
                        <button
                          type="button"
                          aria-label={`Unlink ${identity.externalId}`}
                          disabled={busy}
                          onClick={() => void unlinkIdentity(identity)}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] disabled:opacity-50"
                        >
                          <Unlink size={14} />
                        </button>
                      ) : (
                        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">Unlinked</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_160px_1fr_auto]">
                <label className="block text-xs font-medium text-[var(--foreground)]">
                  Member
                  <select
                    aria-label="Workspace member"
                    value={principalId}
                    onChange={(event) => setPrincipalId(event.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm outline-none"
                  >
                    <option value="">Choose a member…</option>
                    {members.filter((member) => member.principalId).map((member) => (
                      <option key={member.principalId!} value={member.principalId!}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-[var(--foreground)]">
                  Platform
                  <select
                    aria-label="Chat platform"
                    value={directory}
                    onChange={(event) => setDirectory(event.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm outline-none"
                  >
                    {DIRECTORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-[var(--foreground)]">
                  Platform user id
                  <input
                    aria-label="Platform user id"
                    value={externalId}
                    onChange={(event) => setExternalId(event.target.value)}
                    placeholder={directory === 'slack' ? 'U012ABC34' : 'Teams user id'}
                    className="mt-1.5 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--muted)]"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy || !principalId || !externalId.trim()}
                    onClick={() => void linkIdentity()}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-3 text-sm font-medium text-[var(--background)] disabled:opacity-50"
                  >
                    <Plus size={15} /> Link
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">
                Unlinking stops future bot invocation for that identity immediately. Workspace
                membership and message history are unchanged.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
