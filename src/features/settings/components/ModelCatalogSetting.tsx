'use client'

import { useMemo, useState } from 'react'
import { RefreshCw, Search, Sparkles, ScanEye } from 'lucide-react'
import { SettingsToggle } from '@overlay/modules-react/settings'
import {
  AVAILABLE_MODELS,
  DEFAULT_CURATED_CHAT_MODEL_IDS,
} from '@/shared/ai/gateway/model-data'
import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'

function formatPrice(value?: number) {
  if (value === undefined) return 'Unpriced'
  if (value === 0) return 'Free'
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}/1M`
}

export function ModelCatalogSetting({
  enabledModelIds,
  disabled,
  onChange,
}: {
  enabledModelIds: readonly string[]
  disabled?: boolean
  onChange: (ids: string[]) => void
}) {
  const { models, isLoading, error, refresh, revision } = useGatewayModelCatalog()
  const [query, setQuery] = useState('')

  const effectiveIds = enabledModelIds.length > 0
    ? enabledModelIds
    : DEFAULT_CURATED_CHAT_MODEL_IDS
  const enabled = useMemo(() => new Set(effectiveIds), [effectiveIds])
  const curatedIds = useMemo(() => new Set<string>(DEFAULT_CURATED_CHAT_MODEL_IDS), [])
  const displayModels = useMemo(() => {
    void revision
    const gatewayIds = new Set(models.map((model) => model.id))
    const existingDefaults: GatewayCatalogModel[] = AVAILABLE_MODELS
      .filter((model) => curatedIds.has(model.id) && !gatewayIds.has(model.id))
      .map((model) => ({
        id: model.id,
        gatewayId: model.id,
        name: model.name,
        type: 'language',
        provider: model.provider,
        description: model.description,
        tags: [
          ...(model.supportsVision ? ['vision'] : []),
          ...(model.supportsReasoning ? ['reasoning'] : []),
        ],
        pricing: { input: 0, output: 0 },
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      }))
    return [...existingDefaults, ...models]
  }, [curatedIds, models, revision])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return displayModels
    return displayModels.filter((model) =>
      `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(normalized),
    )
  }, [displayModels, query])

  function toggle(modelId: string) {
    const next = new Set(effectiveIds)
    if (next.has(modelId)) {
      if (next.size === 1) return
      next.delete(modelId)
    } else {
      next.add(modelId)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models or providers"
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]"
            />
          </div>
          <button
            type="button"
            aria-label="Refresh models"
            disabled={isLoading}
            onClick={() => void refresh()}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...DEFAULT_CURATED_CHAT_MODEL_IDS])}
            className="hidden h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs text-[var(--foreground)] sm:block"
          >
            Reset defaults
          </button>
        </div>
        <div className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          {effectiveIds.length} enabled · {displayModels.length} available models
        </div>
        {error ? <div className="px-4 py-6 text-sm text-red-500">{error}</div> : null}
        {!error ? (
          <div className="max-h-[34rem] divide-y divide-[var(--border)] overflow-y-auto">
            {filtered.map((model: GatewayCatalogModel) => {
              const hasUsagePricing =
                model.inputPricePerMillion !== undefined &&
                model.outputPricePerMillion !== undefined
              return (
              <div
                key={model.id}
                className={`flex items-center gap-4 px-4 py-3 transition-colors ${
                  hasUsagePricing ? 'hover:bg-[var(--surface-muted)]' : 'opacity-55'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--foreground)]">{model.name}</span>
                    {model.tags.includes('vision') ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                        <ScanEye size={11} strokeWidth={1.6} />
                      </span>
                    ) : null}
                    {model.tags.includes('reasoning') ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                        <Sparkles size={11} strokeWidth={1.6} />
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                    <span className="capitalize">{model.provider}</span>
                    <span>·</span>
                    {hasUsagePricing ? (
                      <>
                        <span>{formatPrice(model.inputPricePerMillion)} in</span>
                        <span>·</span>
                        <span>{formatPrice(model.outputPricePerMillion)} out</span>
                      </>
                    ) : (
                      <span>Pricing unavailable</span>
                    )}
                    {curatedIds.has(model.id) ? <><span>·</span><span>Default</span></> : null}
                  </div>
                </div>
                <SettingsToggle
                  checked={enabled.has(model.id)}
                  disabled={
                    disabled ||
                    !hasUsagePricing ||
                    (enabled.has(model.id) && enabled.size === 1)
                  }
                  onChange={() => toggle(model.id)}
                />
              </div>
              )
            })}
            {!isLoading && filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">No models match your search.</div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
