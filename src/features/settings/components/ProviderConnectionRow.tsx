'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  Pencil,
  RefreshCw,
  ScanEye,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { SettingsToggle } from '@overlay/modules-react/settings'
import { getByokPreset } from '@overlay/llm-gateway'
import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import {
  buildProviderModelOptions,
  filterModels,
  formatPrice,
  formatRelativeTime,
  getDiscoveredModelCount,
  getEffectiveSettingsModelIds,
  isDefaultGatewayConnection,
  payloadErrorMessage,
  type DiscoveredModel,
  type ProviderModelOption,
} from './provider-connections-models'

// ─── Connection Row ───

export function ProviderConnectionRow({
  connection,
  gatewayModels,
  gatewayLoading,
  settingsEnabledModelIds,
  settingsModelOrder,
  settingsDisabled,
  onSettingsChange,
  onRefreshConnections,
  onUpdateConnection,
  onRefreshGateway,
  onEdit,
  onDelete,
}: {
  connection: ByokConnectionRow
  gatewayModels: readonly GatewayCatalogModel[]
  gatewayLoading: boolean
  settingsEnabledModelIds: readonly string[]
  settingsModelOrder: readonly string[]
  settingsDisabled: boolean
  onSettingsChange: (patch: { enabledChatModelIds?: string[]; modelOrder?: string[] }) => Promise<unknown>
  onRefreshConnections: () => Promise<void>
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<
      Pick<
        ByokConnectionRow,
        | 'enabledModelIds'
        | 'status'
        | 'lastError'
        | 'lastTestedAt'
        | 'discoveredModelsJson'
        | 'discoveredAt'
        | 'displayName'
        | 'endpoint'
      >
    >,
  ) => void
  onRefreshGateway: () => Promise<void>
  onEdit: () => void
  onDelete: () => void
}) {
  const preset = getByokPreset(connection.providerId)
  const discoveredCount = getDiscoveredModelCount(connection)
  const hasError = connection.status === 'error'
  const defaultGateway = isDefaultGatewayConnection(connection)
  const allModels = useMemo(
    () => buildProviderModelOptions(connection, gatewayModels),
    [connection, gatewayModels],
  )
  const effectiveSettingsIds = useMemo(
    () => new Set(getEffectiveSettingsModelIds(settingsEnabledModelIds)),
    [settingsEnabledModelIds],
  )
  const enabledCount = allModels.filter((model) => effectiveSettingsIds.has(model.appModelId)).length
  const displayModelCount = defaultGateway && allModels.length > 0 ? allModels.length : discoveredCount
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [savingModelId, setSavingModelId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const filteredModels = useMemo(() => filterModels(allModels, query), [allModels, query])

  const discoverModels = useCallback(async () => {
    setExpanded(true)
    setDiscovering(true)
    setRowError(null)
    try {
      if (defaultGateway) await onRefreshGateway()
      const res = await fetch('/api/v1/providers/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection._id }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; models?: DiscoveredModel[]; error?: string } | null
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? payloadErrorMessage(data) ?? 'Failed to search provider models')
      }
      const now = Date.now()
      const updateRes = await fetch('/api/v1/providers/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connection._id,
          status: 'active',
          lastTestedAt: now,
          discoveredModelsJson: JSON.stringify({ data: data.models ?? [] }),
          discoveredAt: now,
        }),
      })
      if (!updateRes.ok) {
        const payload = await updateRes.json().catch(() => null)
        throw new Error(payloadErrorMessage(payload) ?? 'Failed to save discovered models')
      }
      await onRefreshConnections()
    } catch (value) {
      setRowError(value instanceof Error ? value.message : 'Failed to search provider models')
    } finally {
      setDiscovering(false)
    }
  }, [connection._id, defaultGateway, onRefreshConnections, onRefreshGateway])

  const toggleModel = useCallback(async (model: ProviderModelOption) => {
    const isEnabled = effectiveSettingsIds.has(model.appModelId)
    const nextSettingsIds = getEffectiveSettingsModelIds(settingsEnabledModelIds)
    const nextSettingsSet = new Set(nextSettingsIds)
    if (isEnabled) {
      nextSettingsSet.delete(model.appModelId)
    } else {
      nextSettingsSet.add(model.appModelId)
    }
    const nextEnabledSettingsIds = Array.from(nextSettingsSet)
    if (nextEnabledSettingsIds.length === 0) {
      setRowError('At least one model must remain enabled.')
      return
    }

    const rawSet = new Set(connection.enabledModelIds)
    if (!defaultGateway) {
      if (isEnabled) rawSet.delete(model.rawId)
      else rawSet.add(model.rawId)
    }

    const nextOrder = settingsModelOrder.length > 0
      ? isEnabled
        ? settingsModelOrder.filter((id) => id !== model.appModelId)
        : settingsModelOrder.includes(model.appModelId)
          ? [...settingsModelOrder]
          : [...settingsModelOrder, model.appModelId]
      : undefined

    setSavingModelId(model.rawId)
    setRowError(null)
    try {
      if (!defaultGateway) {
        const res = await fetch('/api/v1/providers/connections', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: connection._id,
            enabledModelIds: Array.from(rawSet),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(payloadErrorMessage(payload) ?? 'Failed to update provider models')
        }
        onUpdateConnection(connection._id, { enabledModelIds: Array.from(rawSet) })
      }
      await onSettingsChange({
        enabledChatModelIds: nextEnabledSettingsIds,
        ...(nextOrder ? { modelOrder: nextOrder } : {}),
      })
    } catch (value) {
      setRowError(value instanceof Error ? value.message : 'Failed to update model')
    } finally {
      setSavingModelId(null)
    }
  }, [
    connection._id,
    connection.enabledModelIds,
    defaultGateway,
    effectiveSettingsIds,
    onUpdateConnection,
    onSettingsChange,
    settingsEnabledModelIds,
    settingsModelOrder,
  ])

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Status indicator */}
        <span
          className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
            hasError
              ? 'bg-red-500'
              : connection.status === 'active'
                ? 'bg-green-500'
                : 'bg-[var(--muted-light)]'
          }`}
        />

        {/* Connection info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--foreground)]">
              {connection.displayName}
            </span>
            {connection.isDefault ? (
              <span className="shrink-0 rounded-full bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted)]">
                DEFAULT
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className="truncate">{preset?.label ?? connection.providerId}</span>
            <span>·</span>
            <span className="shrink-0">
              {enabledCount} enabled
              {displayModelCount > 0 ? ` · ${displayModelCount} model${displayModelCount !== 1 ? 's' : ''}` : ' · 0 models'}
            </span>
            {connection.lastTestedAt ? (
              <>
                <span>·</span>
                <span className="shrink-0">Searched {formatRelativeTime(connection.lastTestedAt)}</span>
              </>
            ) : null}
          </div>
          {hasError && connection.lastError ? (
            <div className="mt-1 flex items-center gap-1 text-xs text-red-500">
              <AlertCircle size={11} className="shrink-0" />
              <span className="truncate">{connection.lastError}</span>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={discoverModels}
            disabled={discovering || (defaultGateway && gatewayLoading)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-50"
            aria-label="Search provider models"
          >
            {discovering ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label={expanded ? 'Hide provider models' : 'Show provider models'}
          >
            <ChevronRight
              size={15}
              strokeWidth={1.8}
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label="Edit provider"
          >
            <Pencil size={14} strokeWidth={1.8} />
          </button>
          {connection.isDeletable ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-red-500"
              aria-label="Delete provider"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-[var(--border)] bg-[var(--background)]/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${connection.displayName} models`}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
              />
            </div>
            <button
              type="button"
              onClick={discoverModels}
              disabled={discovering || (defaultGateway && gatewayLoading)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-elevated)] disabled:opacity-50"
            >
              {discovering ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Search
            </button>
          </div>

          {rowError ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              <span>{rowError}</span>
            </div>
          ) : null}

          <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
            {filteredModels.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {filteredModels.map((model) => {
                  const checked = effectiveSettingsIds.has(model.appModelId)
                  const saving = savingModelId === model.rawId
                  return (
                    <div
                      key={model.appModelId}
                      className="flex items-center gap-4 px-3 py-3 transition-colors hover:bg-[var(--surface-muted)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--foreground)]">{model.name}</span>
                          {model.supportsVision ? (
                            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                              <ScanEye size={11} strokeWidth={1.6} />
                            </span>
                          ) : null}
                          {model.supportsReasoning ? (
                            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                              <Sparkles size={11} strokeWidth={1.6} />
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                          <span className="truncate">{model.provider ?? connection.displayName}</span>
                          <span>·</span>
                          <span className="truncate">{model.rawId}</span>
                          {model.inputPricePerMillion !== undefined || model.outputPricePerMillion !== undefined ? (
                            <>
                              <span>·</span>
                              <span>{formatPrice(model.inputPricePerMillion)} in</span>
                              <span>·</span>
                              <span>{formatPrice(model.outputPricePerMillion)} out</span>
                            </>
                          ) : null}
                          {model.isDefault ? <><span>·</span><span>Default</span></> : null}
                        </div>
                      </div>
                      <SettingsToggle
                        checked={checked}
                        disabled={settingsDisabled || saving}
                        onChange={() => { void toggleModel(model) }}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                {query.trim()
                  ? 'No models match your search.'
                  : 'No models discovered yet. Search this provider to load its model list.'}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
