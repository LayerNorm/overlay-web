'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, RefreshCw, RotateCw, Trash2 } from 'lucide-react'
import type { ApiKeyScope } from '@/shared/auth/api-key-scopes'

type ApiKeyRow = {
  id: string
  name?: string
  scopes: ApiKeyScope[]
  createdAt: number
  expiresAt: number
  revokedAt?: number
}

const SCOPES: Array<{ id: ApiKeyScope; label: string }> = [
  { id: 'chat:read', label: 'Read chats' },
  { id: 'chat:write', label: 'Write chats' },
  { id: 'files:read', label: 'Read files' },
  { id: 'files:write', label: 'Write files' },
]

export function ApiKeySettings() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['chat:read'])
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/api-keys', { cache: 'no-store' })
    if (!response.ok) throw new Error('Failed to load API keys')
    setKeys((await response.json() as { keys: ApiKeyRow[] }).keys)
  }, [])

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load])

  async function mutate(action: () => Promise<Response>) {
    setBusy(true)
    setError(null)
    try {
      const response = await action()
      const payload = await response.json().catch(() => ({})) as { error?: string; key?: ApiKeyRow & { key: string } }
      if (!response.ok) throw new Error(payload.error || 'API key operation failed')
      if (payload.key?.key) setRevealedKey(payload.key.key)
      await load()
    } catch (mutationError) {
      setError(message(mutationError))
    } finally {
      setBusy(false)
    }
  }

  async function copyKey() {
    if (!revealedKey) return
    await navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((current) => current.includes(scope)
      ? current.filter((candidate) => candidate !== scope)
      : [...current, scope])
  }

  return (
    <section className="border-y border-[var(--border)] py-5" data-testid="api-key-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound size={17} strokeWidth={1.8} />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">API keys</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">Create scoped credentials for automation and service access.</p>
        </div>
        <button
          type="button"
          aria-label="Refresh API keys"
          className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)]"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <input
          aria-label="API key name"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none"
          placeholder="Deployment key"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="h-9 rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50"
          disabled={busy || scopes.length === 0}
          onClick={() => void mutate(() => fetch('/api/v1/api-keys', {
            body: JSON.stringify({ name: name.trim() || undefined, scopes }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }))}
        >
          Create key
        </button>
        <div className="flex flex-wrap gap-x-4 gap-y-2 md:col-span-2">
          {SCOPES.map((scope) => (
            <label key={scope.id} className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} />
              {scope.label}
            </label>
          ))}
        </div>
      </div>

      {revealedKey ? (
        <div className="mt-4 border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <p className="text-xs text-[var(--muted)]">Copy this key now. It will not be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto text-xs" data-testid="revealed-api-key">{revealedKey}</code>
            <button type="button" aria-label="Copy API key" className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)]" onClick={() => void copyKey()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {keys.length === 0 ? <p className="py-5 text-sm text-[var(--muted)]">No API keys.</p> : keys.map((key) => (
          <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">{key.name || 'Unnamed key'}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {key.scopes.join(', ')} · expires {new Date(key.expiresAt).toLocaleDateString()}{key.revokedAt ? ' · revoked' : ''}
              </p>
            </div>
            {!key.revokedAt ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Rotate ${key.name || 'API key'}`}
                  className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)]"
                  disabled={busy}
                  onClick={() => void mutate(() => fetch('/api/v1/api-keys', {
                    body: JSON.stringify({ id: key.id, name: key.name, scopes: key.scopes }),
                    headers: { 'content-type': 'application/json' },
                    method: 'PATCH',
                  }))}
                >
                  <RotateCw size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Revoke ${key.name || 'API key'}`}
                  className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] text-red-600 dark:text-red-400"
                  disabled={busy}
                  onClick={() => void mutate(() => fetch('/api/v1/api-keys', {
                    body: JSON.stringify({ id: key.id, reason: 'revoked_from_settings' }),
                    headers: { 'content-type': 'application/json' },
                    method: 'DELETE',
                  }))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'API key operation failed'
}
