'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { ProviderAccountResource } from '@overlay/api-client'
import { Button, DialogFrame, Input, SegmentedControl } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_IDS,
  checkAgentProviderSecret,
  type AgentProviderAuthMethod,
  type AgentProviderId,
} from '@/shared/agents/provider-accounts'

const METHOD_LABEL: Record<AgentProviderAuthMethod, string> = { subscription: 'Subscription', api_key: 'API key' }

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
          }).catch(() => undefined)
        }}
        className="text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  )
}

/** Connect a new account, or replace the credential on one that needs reconnecting. */
export function AccountDialog({ target, initialProvider, onClose, onSaved }: {
  target: ProviderAccountResource | null
  /** Which agent's account to start on when connecting a new one. */
  initialProvider?: AgentProviderId
  onClose(): void
  onSaved(account?: ProviderAccountResource): void
}) {
  const [provider, setProvider] = useState<AgentProviderId>(target?.provider ?? initialProvider ?? 'claude-code')
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
      let saved: ProviderAccountResource | undefined
      if (target) await overlayAppClient.providerAccounts.reconnect(target.id, check.secret)
      else saved = (await overlayAppClient.providerAccounts.connect({ provider, method, secret: check.secret, ...(label.trim() ? { label: label.trim() } : {}) })).account
      // The credential leaves this component the moment it is saved.
      setSecret('')
      onSaved(saved)
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
