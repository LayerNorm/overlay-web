'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import type { ProviderAccountResource } from '@overlay/api-client'
import { Button, DialogFrame, Input, SegmentedControl } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_IDS,
  checkAgentProviderSecret,
  type AgentProviderAuthMethod,
  type AgentProviderId,
} from '@/shared/agents/provider-accounts'

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

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-1.5 py-0.5 align-middle">
      <code className="text-[11px] text-[var(--foreground)]">{command}</code>
      <button
        type="button"
        aria-label={`Copy ${command}`}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_500)
          }).catch((_error) => undefined)
        }}
        className="text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  )
}

/** Connect a new account, or replace the credential on one that needs reconnecting. */
function AccountDialog({ target, onClose, onSaved }: {
  target: ProviderAccountResource | null
  onClose(): void
  onSaved(): void
}) {
  const [provider, setProvider] = useState<AgentProviderId>(target?.provider ?? 'claude-code')
  const [method, setMethod] = useState<AgentProviderAuthMethod>(target?.method ?? 'subscription')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const definition = AGENT_PROVIDERS[provider]
  const reconnecting = target !== null
  const check = checkAgentProviderSecret(provider, method, secret)
  const help = definition.help[method]

  const pickProvider = (next: AgentProviderId) => {
    setProvider(next)
    // A provider only offers the methods it supports (Codex: API key).
    if (!AGENT_PROVIDERS[next].methods.includes(method)) setMethod(AGENT_PROVIDERS[next].methods[0]!)
    setError(null)
  }

  const submit = async () => {
    if (!check.ok || busy) return
    setBusy(true)
    setError(null)
    try {
      if (target) await overlayAppClient.providerAccounts.reconnect(target.id, check.secret)
      else await overlayAppClient.providerAccounts.connect({ provider, method, secret: check.secret, ...(label.trim() ? { label: label.trim() } : {}) })
      // The credential leaves this component the moment it is saved.
      setSecret('')
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      open
      onOpenChange={(open) => { if (!open && !busy) onClose() }}
      title={reconnecting ? `Reconnect ${target.label}` : 'Connect an account'}
      aria-label={reconnecting ? 'Reconnect account' : 'Connect an account'}
    >
      <div className="mt-4 space-y-4">
        {!reconnecting ? (
          <>
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Agent</p>
              <SegmentedControl
                ariaLabel="Agent"
                layout="stretch"
                value={provider}
                options={AGENT_PROVIDER_IDS.map((id) => ({ value: id, label: AGENT_PROVIDERS[id].label }))}
                onChange={pickProvider}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Sign in with</p>
              <SegmentedControl
                ariaLabel="Sign-in method"
                layout="stretch"
                value={method}
                options={(['subscription', 'api_key'] as const).map((id) => ({
                  value: id,
                  label: METHOD_LABEL[id],
                  ...(definition.methods.includes(id) ? {} : { disabled: true, description: 'Coming soon' }),
                }))}
                onChange={(next) => { setMethod(next); setError(null) }}
              />
            </div>
          </>
        ) : null}

        <div>
          <label htmlFor="agent-account-secret" className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
            {method === 'subscription' ? 'Setup token' : 'API key'}
          </label>
          <Input
            id="agent-account-secret"
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(event) => { setSecret(event.target.value); setError(null) }}
            placeholder={method === 'subscription' ? 'sk-ant-oat01-…' : provider === 'codex' ? 'sk-…' : 'sk-ant-api03-…'}
          />
          {help ? (
            <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
              {method === 'subscription' && provider === 'claude-code'
                ? <>Run <CopyCommand command="claude setup-token" /> on your own computer and paste the token it prints. Overlay never reads your existing Claude login.</>
                : help}
            </p>
          ) : null}
        </div>

        {!reconnecting ? (
          <div>
            <label htmlFor="agent-account-label" className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
              Name <span className="font-normal text-[var(--muted-light)]">optional</span>
            </label>
            <Input id="agent-account-label" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder={`${definition.label} ${METHOD_LABEL[method].toLowerCase()}`} />
          </div>
        ) : null}

        {secret && !check.ok ? <p className="text-xs text-[var(--muted)]">{check.reason}</p> : null}
        {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !check.ok}>
          {busy ? 'Saving…' : reconnecting ? 'Reconnect' : 'Connect'}
        </Button>
      </div>
    </DialogFrame>
  )
}
