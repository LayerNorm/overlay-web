'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { DialogFrame } from '@overlay/ui/primitives'
import {
  BYOK_PROVIDER_PRESETS,
  getByokPreset,
} from '@overlay/llm-gateway'
import {
  formatByokModelDisplayName,
  parseDiscoveredModels,
} from '@/shared/ai/gateway/byok-model-conversion'
import {
  type DialogState,
  type DiscoveredModel,
} from './provider-connections-models'

// ─── Provider Dialog (Add / Edit) ───

export interface ProviderDialogProps {
  state: Exclude<DialogState, null>
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onSaved: () => void
}

export function ProviderDialog({ state, busy, onBusyChange, onClose, onSaved }: ProviderDialogProps) {
  const isEdit = state.mode === 'edit'
  const existing = state.mode === 'edit' ? state.connection : null

  const [providerId, setProviderId] = useState(existing?.providerId ?? 'openrouter')
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [apiKey, setApiKey] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; models: DiscoveredModel[]; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(existing?.enabledModelIds ?? [])
  const [showApiKey, setShowApiKey] = useState(false)

  const preset = getByokPreset(providerId)

  // Fixed presets are locked to their vendor URL. The custom preset requires
  // an explicit user URL and is guarded on the server before any key is sent.
  useEffect(() => {
    if (preset && !preset.allowsCustomEndpoint && !endpoint) {
      setEndpoint(preset.defaultBaseURL)
    }
  }, [preset, endpoint])

  // Pre-fill display name from preset label
  useEffect(() => {
    if (!displayName && preset && !isEdit) {
      setDisplayName(preset.label)
    }
  }, [preset, displayName, isEdit])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/v1/providers/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: existing?._id,
          providerId,
          endpoint: endpoint || preset?.defaultBaseURL,
          apiKey: apiKey || undefined,
        }),
      })
      const data = await res.json() as { ok: boolean; models: DiscoveredModel[]; error?: string }
      setTestResult(data)
      if (data.ok && data.models.length > 0) {
        // Auto-select all models on first test
        setEnabledModelIds(data.models.map((m) => m.id))
      }
    } catch (e) {
      setTestResult({ ok: false, models: [], error: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }, [existing?._id, providerId, endpoint, apiKey, preset])

  const handleSave = useCallback(async () => {
    onBusyChange(true)
    try {
      if (isEdit && existing) {
        const customEndpointChanged = Boolean(
          preset?.allowsCustomEndpoint &&
          endpoint.trim().replace(/\/+$/, '') !== existing.endpoint.trim().replace(/\/+$/, ''),
        )
        const body: Record<string, unknown> = {
          connectionId: existing._id,
          displayName,
          enabledModelIds,
          status: testResult?.ok
            ? 'active'
            : customEndpointChanged
              ? 'untested'
              : existing.status,
          lastTestedAt: testResult ? Date.now() : undefined,
        }
        if (preset?.allowsCustomEndpoint) body.endpoint = endpoint
        if (apiKey) body.apiKey = apiKey
        if (testResult?.ok) {
          body.discoveredModelsJson = JSON.stringify({ data: testResult.models })
          body.discoveredAt = Date.now()
        }
        if (testResult && !testResult.ok) {
          body.status = 'error'
          body.lastError = testResult.error
        }

        const res = await fetch('/api/v1/providers/connections', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) onSaved()
      } else {
        // Create new connection
        const res = await fetch('/api/v1/providers/connections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            providerId,
            endpoint: endpoint || preset?.defaultBaseURL,
            displayName,
            apiKey,
            enabledModelIds,
          }),
        })
        if (res.ok) {
          // After creation, update with test results if available
          const data = await res.json() as { id: string }
          if (testResult?.ok && data.id) {
            await fetch('/api/v1/providers/connections', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                connectionId: data.id,
                status: 'active',
                lastTestedAt: Date.now(),
                discoveredModelsJson: JSON.stringify({ data: testResult.models }),
                discoveredAt: Date.now(),
              }),
            })
          }
          onSaved()
        }
      }
    } finally {
      onBusyChange(false)
    }
  }, [isEdit, existing, displayName, enabledModelIds, apiKey, providerId, endpoint, preset, testResult, onSaved, onBusyChange])

  const hasRequiredEndpoint = !preset?.allowsCustomEndpoint || endpoint.trim().length > 0
  const hasRequiredApiKey = !preset?.requiresApiKey || Boolean(apiKey) || isEdit
  const canSave = displayName.trim().length > 0 && hasRequiredEndpoint && hasRequiredApiKey
  const canTest = Boolean(preset) && hasRequiredEndpoint && hasRequiredApiKey
  // Provider dropdown options (exclude vercel-ai-gateway for add mode)
  const availablePresets = BYOK_PROVIDER_PRESETS.filter(
    (p) => p.id !== 'vercel-ai-gateway' || isEdit,
  )

  return (
    <DialogFrame
      open={true}
      title={isEdit ? 'Edit provider' : 'Add provider'}
      onOpenChange={(open) => !open && !busy && onClose()}
      className="w-[min(520px,92vw)]"
      footer={
        <>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || busy || !canTest}
            className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Test connection
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !canSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {isEdit ? 'Save changes' : 'Add provider'}
          </button>
        </>
      }
    >
      <div className="mt-4 flex flex-col gap-4">
        {/* Provider selector — only for add mode */}
        {!isEdit ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Provider</label>
            <div className="relative">
              <select
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value)
                  setTestResult(null)
                  setEnabledModelIds([])
                  const newPreset = getByokPreset(e.target.value)
                  setEndpoint(newPreset?.defaultBaseURL ?? '')
                  setDisplayName(newPreset?.label ?? '')
                }}
                className="h-10 w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 pr-8 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
              >
                {availablePresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            </div>
            {preset?.docsURL ? (
              <a
                href={preset.docsURL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-light)] hover:text-[var(--muted)]"
              >
                <ExternalLink size={10} />
                Provider docs
              </a>
            ) : null}
          </div>
        ) : null}

        {preset?.allowsCustomEndpoint ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
              API base URL
            </label>
            <input
              type="url"
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value)
                setTestResult(null)
                setEnabledModelIds([])
              }}
              autoComplete="url"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
            />
            <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted-light)]">
              Use an HTTPS OpenAI-compatible base URL. Overlay blocks redirects and private-network addresses before sending your key.
            </p>
          </div>
        ) : null}

        {/* API Key */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
            API key{preset?.requiresApiKey === false ? ' (optional)' : ''}
            {isEdit ? ' (leave blank to keep existing)' : ''}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={isEdit ? '••••••••' : 'Enter your API key'}
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 pr-10 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-light)] hover:text-[var(--muted)]"
            >
              {showApiKey ? <X size={14} /> : <KeyRound size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            placeholder="e.g. Personal OpenRouter key"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
          />
        </div>

        {/* Test results */}
        {testResult ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
            {testResult.ok ? (
              <>
                <div className="flex items-center gap-2 text-xs font-medium text-green-600 dark:text-green-400">
                  <Check size={14} />
                  Connected — {testResult.models.length} model{testResult.models.length !== 1 ? 's' : ''} found
                </div>
                {testResult.models.length > 0 ? (
                  <div className="mt-2 max-h-40 overflow-y-auto">
                    <p className="mb-1.5 text-[11px] text-[var(--muted)]">Select models to enable:</p>
                    {testResult.models.map((model) => (
                      <label
                        key={model.id}
                        className="flex cursor-pointer items-center gap-2 py-1 text-xs text-[var(--foreground)]"
                      >
                        <input
                          type="checkbox"
                          checked={enabledModelIds.includes(model.id)}
                          onChange={() => {
                            setEnabledModelIds((prev) =>
                              prev.includes(model.id)
                                ? prev.filter((id) => id !== model.id)
                                : [...prev, model.id],
                            )
                          }}
                          className="h-3.5 w-3.5 rounded border-[var(--border)]"
                        />
                        <span className="truncate">{formatByokModelDisplayName(model.id, model.name)}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle size={14} className="shrink-0" />
                <span className="truncate">{testResult.error ?? 'Connection failed'}</span>
              </div>
            )}
          </div>
        ) : null}

        {/* Existing discovered models (edit mode, before re-test) */}
        {isEdit && existing && !testResult && existing.discoveredModelsJson ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
            <p className="mb-2 text-xs font-medium text-[var(--muted)]">
              {parseDiscoveredModels(existing.discoveredModelsJson).length} discovered models
            </p>
            <div className="max-h-32 overflow-y-auto">
              {parseDiscoveredModels(existing.discoveredModelsJson).map((model) => (
                <label
                  key={model.id}
                  className="flex cursor-pointer items-center gap-2 py-1 text-xs text-[var(--foreground)]"
                >
                  <input
                    type="checkbox"
                    checked={enabledModelIds.includes(model.id)}
                    onChange={() => {
                      setEnabledModelIds((prev) =>
                        prev.includes(model.id)
                          ? prev.filter((id) => id !== model.id)
                          : [...prev, model.id],
                      )
                    }}
                    className="h-3.5 w-3.5 rounded border-[var(--border)]"
                  />
                  <span className="truncate">{formatByokModelDisplayName(model.id, model.name)}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </DialogFrame>
  )
}
