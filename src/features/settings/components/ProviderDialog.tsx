'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { DialogFrame, Toggle } from '@overlay/ui/primitives'
import {
  BYOK_PROVIDER_PRESETS,
  getByokPreset,
  type ByokProviderPreset,
} from '@overlay/llm-gateway'
import {
  type ByokConnectionRow,
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

type ConnectionTestResult = { ok: boolean; models: DiscoveredModel[]; error?: string }

function toggleModelId(ids: string[], modelId: string): string[] {
  return ids.includes(modelId)
    ? ids.filter((id) => id !== modelId)
    : [...ids, modelId]
}

function buildEditBody({
  existing,
  preset,
  endpoint,
  displayName,
  enabledModelIds,
  apiKey,
  testResult,
}: {
  existing: ByokConnectionRow
  preset: ByokProviderPreset | undefined
  endpoint: string
  displayName: string
  enabledModelIds: string[]
  apiKey: string
  testResult: ConnectionTestResult | null
}): Record<string, unknown> {
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
  return body
}

async function testProviderConnection({
  existing,
  providerId,
  endpoint,
  apiKey,
  preset,
  setTesting,
  setTestResult,
  setEnabledModelIds,
}: {
  existing: ByokConnectionRow | null
  providerId: string
  endpoint: string
  apiKey: string
  preset: ByokProviderPreset | undefined
  setTesting: (testing: boolean) => void
  setTestResult: (result: ConnectionTestResult | null) => void
  setEnabledModelIds: (ids: string[]) => void
}) {
  setTesting(true)
  setTestResult(null)
  try {
    // Guarded by `testing` at the top of handleTest; the /test endpoint's
    // structured body (data.ok/data.error) is the real status signal.
    // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check, react-doctor/no-async-event-handler-without-reentry-guard
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
    const data = await res.json() as ConnectionTestResult
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
}

async function saveProviderConnection({
  isEdit,
  existing,
  preset,
  endpoint,
  displayName,
  enabledModelIds,
  apiKey,
  testResult,
  providerId,
  onSaved,
}: {
  isEdit: boolean
  existing: ByokConnectionRow | null
  preset: ByokProviderPreset | undefined
  endpoint: string
  displayName: string
  enabledModelIds: string[]
  apiKey: string
  testResult: ConnectionTestResult | null
  providerId: string
  onSaved: () => void
}) {
  if (isEdit && existing) {
    const res = await fetch('/api/v1/providers/connections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEditBody({
        existing,
        preset,
        endpoint,
        displayName,
        enabledModelIds,
        apiKey,
        testResult,
      })),
    })
    if (res.ok) onSaved()
    return
  }

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
  if (!res.ok) return
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

function ProviderPresetSelect({
  providerId,
  presets,
  docsURL,
  onSelect,
}: {
  providerId: string
  presets: readonly ByokProviderPreset[]
  docsURL?: string
  onSelect: (providerId: string) => void
}) {
  return (
    <div>
      <label htmlFor="provider-id" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Provider</label>
      <div className="relative">
        <select
          id="provider-id"
          value={providerId}
          onChange={(e) => onSelect(e.target.value)}
          className="h-10 w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 pr-8 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
      </div>
      {docsURL ? (
        <a
          href={docsURL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--muted-light)] hover:text-[var(--muted)]"
        >
          <ExternalLink size={10} />
          Provider docs
        </a>
      ) : null}
    </div>
  )
}

function ProviderEndpointField({
  endpoint,
  onEndpointChange,
}: {
  endpoint: string
  onEndpointChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor="provider-endpoint" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
        API base URL
      </label>
      <input
        id="provider-endpoint"
        type="url"
        value={endpoint}
        onChange={(event) => onEndpointChange(event.target.value)}
        autoComplete="url"
        spellCheck={false}
        placeholder="https://api.example.com/v1"
        className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
      />
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted-light)]">
        Use an HTTPS OpenAI-compatible base URL. Overlay blocks redirects and private-network addresses before sending your key.
      </p>
    </div>
  )
}

function ProviderApiKeyField({
  apiKey,
  showApiKey,
  optional,
  isEdit,
  onApiKeyChange,
  onToggleShow,
}: {
  apiKey: string
  showApiKey: boolean
  optional: boolean
  isEdit: boolean
  onApiKeyChange: (value: string) => void
  onToggleShow: () => void
}) {
  return (
    <div>
      <label htmlFor="provider-api-key" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
        API key{optional ? ' (optional)' : ''}
        {isEdit ? ' (leave blank to keep existing)' : ''}
      </label>
      <div className="relative">
        <input
          id="provider-api-key"
          type={showApiKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={isEdit ? '••••••••' : 'Enter your API key'}
          className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 pr-10 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
        />
        <button
          type="button"
          aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-light)] hover:text-[var(--muted)]"
        >
          {showApiKey ? <X size={14} /> : <KeyRound size={14} />}
        </button>
      </div>
    </div>
  )
}

function ModelToggleList({
  models,
  enabledModelIds,
  onToggleModel,
}: {
  models: DiscoveredModel[]
  enabledModelIds: string[]
  onToggleModel: (modelId: string) => void
}) {
  const enabledModelIdSet = new Set(enabledModelIds)
  return (
    <>
      {models.map((model) => (
        <div
          key={model.id}
          className="flex items-center gap-3 border-b border-[var(--border)] py-1.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{formatByokModelDisplayName(model.id, model.name)}</span>
          <Toggle
            checked={enabledModelIdSet.has(model.id)}
            onCheckedChange={() => onToggleModel(model.id)}
            aria-label={formatByokModelDisplayName(model.id, model.name)}
          />
        </div>
      ))}
    </>
  )
}

function ConnectionTestResultPanel({
  testResult,
  enabledModelIds,
  onToggleModel,
}: {
  testResult: ConnectionTestResult
  enabledModelIds: string[]
  onToggleModel: (modelId: string) => void
}) {
  return (
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
              <ModelToggleList
                models={testResult.models}
                enabledModelIds={enabledModelIds}
                onToggleModel={onToggleModel}
              />
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
  )
}

function ExistingModelsPanel({
  connection,
  enabledModelIds,
  onToggleModel,
}: {
  connection: ByokConnectionRow
  enabledModelIds: string[]
  onToggleModel: (modelId: string) => void
}) {
  const models = parseDiscoveredModels(connection.discoveredModelsJson)
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
      <p className="mb-2 text-xs font-medium text-[var(--muted)]">
        {models.length} discovered models
      </p>
      <div className="max-h-32 overflow-y-auto">
        <ModelToggleList
          models={models}
          enabledModelIds={enabledModelIds}
          onToggleModel={onToggleModel}
        />
      </div>
    </div>
  )
}

function ProviderDialogFooter({
  testing,
  busy,
  canTest,
  canSave,
  isEdit,
  onTest,
  onCancel,
  onSave,
}: {
  testing: boolean
  busy: boolean
  canTest: boolean
  canSave: boolean
  isEdit: boolean
  onTest: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onTest}
        disabled={testing || busy || !canTest}
        className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Test connection
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={busy || !canSave}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {isEdit ? 'Save changes' : 'Add provider'}
      </button>
    </>
  )
}

function useProviderForm({ state, isEdit, onBusyChange, onSaved }: {
  state: ProviderDialogProps['state']
  isEdit: boolean
  onBusyChange: (busy: boolean) => void
  onSaved: ProviderDialogProps['onSaved']
}) {
  const existing = state.mode === 'edit' ? state.connection : null

  const [providerId, setProviderId] = useState(existing?.providerId ?? 'openrouter')
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [apiKey, setApiKey] = useState('')
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(existing?.enabledModelIds ?? [])
  const [showApiKey, setShowApiKey] = useState(false)

  const preset = getByokPreset(providerId)

  // Fixed presets are locked to their vendor URL. The custom preset requires
  // an explicit user URL and is guarded on the server before any key is sent.
  useEffect(() => {
    if (preset && !preset.allowsCustomEndpoint && !endpoint) {
      // Fixed presets enforce their vendor URL — an emptied field refills it.
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
      setEndpoint(preset.defaultBaseURL)
    }
  }, [preset, endpoint])

  // The name users see in the providers list and model picker. Pre-filled from
  // the preset label, or derived from the endpoint host for custom providers —
  // never overwrites a name the user typed.
  const [autoDisplayName, setAutoDisplayName] = useState('')
  const endpointHost = useMemo(() => {
    try {
      return new URL(endpoint.trim()).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }, [endpoint])
  useEffect(() => {
    if (!preset || isEdit) return
    const next = preset.allowsCustomEndpoint && endpointHost ? endpointHost : preset.label
    setDisplayName((current) =>
      current && current !== preset.label && current !== autoDisplayName ? current : next)
    setAutoDisplayName(preset.allowsCustomEndpoint ? endpointHost : '')
  }, [preset, endpointHost, isEdit, autoDisplayName])

  const handleProviderChange = useCallback((nextProviderId: string) => {
    setProviderId(nextProviderId)
    setTestResult(null)
    setEnabledModelIds([])
    const nextPreset = getByokPreset(nextProviderId)
    setEndpoint(nextPreset?.defaultBaseURL ?? '')
    setDisplayName(nextPreset?.label ?? '')
  }, [])

  const handleEndpointChange = useCallback((value: string) => {
    setEndpoint(value)
    setTestResult(null)
    setEnabledModelIds([])
  }, [])

  const handleToggleModel = useCallback((modelId: string) => {
    setEnabledModelIds((prev) => toggleModelId(prev, modelId))
  }, [])

  const handleTest = useCallback(() => {
    if (testing) return
    void testProviderConnection({
      existing,
      providerId,
      endpoint,
      apiKey,
      preset,
      setTesting,
      setTestResult,
      setEnabledModelIds,
    })
  }, [existing, providerId, endpoint, apiKey, preset, testing])

  const handleSave = useCallback(async () => {
    onBusyChange(true)
    try {
      await saveProviderConnection({
        isEdit,
        existing,
        preset,
        endpoint,
        displayName,
        enabledModelIds,
        apiKey,
        testResult,
        providerId,
        onSaved,
      })
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
  return {
    providerId,
    endpoint,
    displayName,
    apiKey,
    testResult,
    testing,
    enabledModelIds,
    showApiKey,
    preset,
    availablePresets,
    setDisplayName,
    setApiKey,
    setShowApiKey,
    handleProviderChange,
    handleEndpointChange,
    handleToggleModel,
    handleTest,
    handleSave,
    existing,
    hasRequiredEndpoint,
    hasRequiredApiKey,
    canSave,
    canTest,
  }
}

export function ProviderDialog({ state, busy, onBusyChange, onClose, onSaved }: ProviderDialogProps) {
  const isEdit = state.mode === 'edit'
  const {
    providerId,
    endpoint,
    displayName,
    apiKey,
    testResult,
    testing,
    enabledModelIds,
    showApiKey,
    preset,
    availablePresets,
    setDisplayName,
    setApiKey,
    setShowApiKey,
    handleProviderChange,
    handleEndpointChange,
    handleToggleModel,
    handleTest,
    handleSave,
    existing,
    canSave,
    canTest,
  } = useProviderForm({ state, isEdit, onBusyChange, onSaved })


  return (
    <DialogFrame
      open={true}
      title={isEdit ? 'Edit provider' : 'Add provider'}
      onOpenChange={(open) => !open && !busy && onClose()}
      className="w-[min(520px,92vw)]"
      footer={
        <ProviderDialogFooter
          testing={testing}
          busy={busy}
          canTest={canTest}
          canSave={canSave}
          isEdit={isEdit}
          onTest={handleTest}
          onCancel={onClose}
          onSave={handleSave}
        />
      }
    >
      <div className="mt-4 flex flex-col gap-4">
        {/* Provider selector — only for add mode */}
        {!isEdit ? (
          <ProviderPresetSelect
            providerId={providerId}
            presets={availablePresets}
            docsURL={preset?.docsURL}
            onSelect={handleProviderChange}
          />
        ) : null}

        <div>
          <label htmlFor="provider-name" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Provider name</label>
          <input
            id="provider-name"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            placeholder={preset?.allowsCustomEndpoint ? 'e.g. OpenCode Zen' : 'e.g. Personal OpenRouter key'}
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
          />
        </div>

        {preset?.allowsCustomEndpoint ? (
          <ProviderEndpointField endpoint={endpoint} onEndpointChange={handleEndpointChange} />
        ) : null}

        <ProviderApiKeyField
          apiKey={apiKey}
          showApiKey={showApiKey}
          optional={preset?.requiresApiKey === false}
          isEdit={isEdit}
          onApiKeyChange={setApiKey}
          onToggleShow={() => setShowApiKey((v) => !v)}
        />

        {/* Test results */}
        {testResult ? (
          <ConnectionTestResultPanel
            testResult={testResult}
            enabledModelIds={enabledModelIds}
            onToggleModel={handleToggleModel}
          />
        ) : null}

        {/* Existing discovered models (edit mode, before re-test) */}
        {isEdit && existing && !testResult && existing.discoveredModelsJson ? (
          <ExistingModelsPanel
            connection={existing}
            enabledModelIds={enabledModelIds}
            onToggleModel={handleToggleModel}
          />
        ) : null}
      </div>
    </DialogFrame>
  )
}
