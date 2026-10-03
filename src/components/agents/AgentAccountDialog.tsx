'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { ProviderAccountResource } from '@overlay/api-client'
import { Button, DialogFrame, Input, SegmentedControl } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  AGENT_PROVIDERS,
  SELECTABLE_AGENT_PROVIDER_IDS,
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

/**
 * Signing in to Codex with ChatGPT: a one-time code to enter at OpenAI, then this waits for the approval. The sign-in
 * goes straight into the vault on the server; nothing secret reaches this page.
 */
function CodexSignIn({ accountId, label, onConnected, onError }: {
  accountId?: string
  label: string
  onConnected(account: ProviderAccountResource): void
  onError(message: string | null): void
}) {
  const [code, setCode] = useState<{ deviceAuthId: string; userCode: string; verificationUrl: string; interval: number; expiresAt: number } | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const done = useRef(false)

  const start = async () => {
    setStarting(true)
    onError(null)
    try {
      setCode(await overlayAppClient.providerAccounts.startCodexSignIn())
    } catch (startError) {
      onError(startError instanceof Error ? startError.message : 'Could not start the sign-in.')
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (!code) return
    done.current = false
    const timer = window.setInterval(() => {
      if (done.current) return
      if (Date.now() > code.expiresAt) {
        done.current = true
        setCode(null)
        onError('That code expired. Start again.')
        return
      }
      void overlayAppClient.providerAccounts.pollCodexSignIn({
        deviceAuthId: code.deviceAuthId, userCode: code.userCode,
        ...(label.trim() ? { label: label.trim() } : {}), ...(accountId ? { accountId } : {}),
      }).then((result) => {
        if (done.current || result.status !== 'connected') return
        done.current = true
        onConnected(result.account)
      }).catch((pollError: unknown) => {
        if (done.current) return
        done.current = true
        setCode(null)
        onError(pollError instanceof Error ? pollError.message : 'The sign-in did not complete.')
      })
    }, Math.max(2, code.interval) * 1_000)
    return () => window.clearInterval(timer)
  }, [code, label, accountId, onConnected, onError])

  if (!code) {
    return (
      <div>
        <Button variant="primary" size="sm" onClick={() => void start()} disabled={starting}>{starting ? 'Starting…' : 'Sign in with ChatGPT'}</Button>
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
          You get a one-time code to enter on OpenAI&rsquo;s site. Overlay keeps the sign-in refreshed and gives each run only a short-lived token.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
      <p className="text-xs text-[var(--foreground)]">
        1. Open <a href={code.verificationUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{code.verificationUrl.replace('https://', '')}</a> and sign in.
      </p>
      <div className="flex items-center gap-2 text-xs text-[var(--foreground)]">
        <span>2. Enter this code:</span>
        <code className="rounded-md border border-[var(--border)] px-2 py-0.5 text-sm font-medium tracking-widest">{code.userCode}</code>
        <button
          type="button"
          aria-label="Copy code"
          className="text-[var(--muted)] hover:text-[var(--foreground)]"
          onClick={() => { void navigator.clipboard?.writeText(code.userCode).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_500) }).catch(() => undefined) }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <p className="text-[11px] text-[var(--muted)]" role="status">Waiting for you to approve it on OpenAI&rsquo;s site (the code expires in 15 minutes). Only enter it if you started this here.</p>
    </div>
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
  const chatgptSignIn = provider === 'codex' && method === 'subscription'

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
                options={SELECTABLE_AGENT_PROVIDER_IDS.map((id) => ({ value: id, label: AGENT_PROVIDERS[id].label }))}
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
                  ...(definition.methods.includes(id) ? {} : { disabled: true, description: 'Not available' }),
                }))}
                onChange={(next) => { setMethod(next); setError(null) }}
              />
            </div>
          </>
        ) : null}

        {definition.experimental ? (
          <p className="rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-[11px] leading-4 text-[var(--muted)]">
            {definition.label} is experimental on Overlay Cloud: it runs with your own key and has not been proven with as many accounts as Claude Code and Codex.
          </p>
        ) : null}

        {chatgptSignIn ? (
          <CodexSignIn
            {...(target ? { accountId: target.id } : {})}
            label={label}
            onError={setError}
            onConnected={(account) => onSaved(account)}
          />
        ) : (
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
        )}

        {!reconnecting ? (
          <div>
            <label htmlFor="agent-account-label" className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
              Name <span className="font-normal text-[var(--muted-light)]">optional</span>
            </label>
            <Input id="agent-account-label" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder={`${definition.label} ${METHOD_LABEL[method].toLowerCase()}`} />
          </div>
        ) : null}

        {!chatgptSignIn && secret && !check.ok ? <p className="text-xs text-[var(--muted)]">{check.reason}</p> : null}
        {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        {chatgptSignIn ? null : (
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !check.ok}>
            {busy ? 'Saving…' : reconnecting ? 'Reconnect' : 'Connect'}
          </Button>
        )}
      </div>
    </DialogFrame>
  )
}
