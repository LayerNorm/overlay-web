'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import type { ProviderAccountResource } from '@overlay/api-client'
import { Button } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { AGENT_PROVIDERS, type AgentProviderAuthMethod } from '@/shared/agents/provider-accounts'
import { AccountDialog } from '@/components/agents/AgentAccountDialog'

const METHOD_LABEL: Record<AgentProviderAuthMethod, string> = { subscription: 'Subscription', api_key: 'API key' }

function describe(account: ProviderAccountResource): string {
  return `${AGENT_PROVIDERS[account.provider].label} · ${METHOD_LABEL[account.method]}`
}

function formatLastUsed(timestamp: number | undefined): string {
  if (!timestamp) return 'Not used yet'
  // Locale pinned so server and client render the same text.
  return `Last used ${new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/**
 * The Claude Code and Codex accounts agents on Overlay Cloud run on. A
 * credential is sent once and never shown again; the list only ever has names
 * and states.
 */
export function AgentAccountSettings() {
  const [accounts, setAccounts] = useState<ProviderAccountResource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'connect' } | { mode: 'reconnect'; account: ProviderAccountResource } | null>(null)
  const [removing, setRemoving] = useState<ProviderAccountResource | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await overlayAppClient.providerAccounts.list({ cache: 'no-store' })
      setAccounts(result.data)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your accounts.')
      setAccounts((current) => current ?? [])
    }
  }, [])

  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect
  useEffect(() => { void refresh() }, [refresh])

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await overlayAppClient.providerAccounts.remove(removing.id)
      setRemoving(null)
      await refresh()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Agent accounts</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Your Claude and OpenAI credentials, used by Claude Code and Codex agents running on Overlay Cloud. They are stored encrypted and sent to an agent only while it works.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setDialog({ mode: 'connect' })}>
            <Plus size={13} className="mr-1" /> Connect account
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="space-y-2">
        {accounts !== null && accounts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
            No accounts yet. Connect one to run Claude Code or Codex on Overlay Cloud.
          </p>
        ) : null}
        {(accounts ?? []).map((account) => (
          <div key={account.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-subtle)] text-[var(--muted)]">
              <KeyRound size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-medium text-[var(--foreground)]">{account.label}</h3>
                {account.status === 'needs_reauth' ? (
                  <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Needs reconnecting
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {describe(account)} · {formatLastUsed(account.lastUsedAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant={account.status === 'needs_reauth' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setDialog({ mode: 'reconnect', account })}
              >
                Reconnect
              </Button>
              <button
                type="button"
                aria-label={`Remove ${account.label}`}
                onClick={() => setRemoving(account)}
                className="rounded-lg p-2 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {dialog ? (
        <AccountDialog
          key={dialog.mode === 'reconnect' ? dialog.account.id : 'connect'}
          target={dialog.mode === 'reconnect' ? dialog.account : null}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void refresh() }}
        />
      ) : null}

      <ConfirmDialog
        isOpen={removing !== null}
        title="Remove this account?"
        description={removing
          ? `${removing.label} is deleted from Overlay. Agents that use it stop working until you connect another.`
          : ''}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
