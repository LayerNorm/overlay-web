'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, ImageIcon, KeyRound, MessageSquare, RefreshCw, Search, Sparkles, ScanEye, Video } from 'lucide-react'
import { SettingsToggle } from '@overlay/modules-react/settings'
import {
  AVAILABLE_MODELS,
  DEFAULT_CURATED_CHAT_MODEL_IDS,
} from '@/shared/ai/gateway/model-data'
import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useByokModels } from '@/components/providers/useByokModels'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { gatewayCatalogModelHasSupportedPricing } from '@/shared/ai/gateway/gateway-catalog'

function formatPrice(value?: number) {
  if (value === undefined) return 'Unpriced'
  if (value === 0) return 'Free'
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}/1M`
}

function formatMediaPrice(model: GatewayCatalogModel): string {
  if (model.type === 'image') {
    const flat = Number(model.pricing.image)
    if (Number.isFinite(flat)) return `$${flat.toFixed(flat < 0.01 ? 3 : 2)}/image`
    if (model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined) {
      return `${formatPrice(model.inputPricePerMillion)} in · ${formatPrice(model.outputPricePerMillion)} out`
    }
  }
  if (model.type === 'video' && Array.isArray(model.pricing.video_duration_pricing)) {
    const prices = model.pricing.video_duration_pricing.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const value = Number((row as Record<string, unknown>).cost_per_second)
      return Number.isFinite(value) ? [value] : []
    })
    if (prices.length > 0) return `from $${Math.min(...prices).toFixed(3)}/second`
  }
  return 'Pricing unavailable'
}

export function ModelCatalogSetting({
  enabledModelIds,
  modelOrder,
  defaultImageModelId,
  defaultVideoModelId,
  disabled,
  onChange,
}: {
  enabledModelIds: readonly string[]
  modelOrder: readonly string[]
  defaultImageModelId?: string
  defaultVideoModelId?: string
  disabled?: boolean
  onChange: (patch: {
    enabledChatModelIds?: string[]
    modelOrder?: string[]
    defaultImageModelId?: string
    defaultVideoModelId?: string
  }) => void
}) {
  const { models, isLoading, error, refresh, revision } = useGatewayModelCatalog()
  const { appDataCapabilities } = useOverlayCapabilities()
  const { connections: byokConnections, refresh: refreshByok } = useByokModels({
    enabled: appDataCapabilities.provider === 'convex',
  })
  const [query, setQuery] = useState('')
  const [catalogType, setCatalogType] = useState<'language' | 'image' | 'video'>('language')

  const effectiveIds = enabledModelIds.length > 0
    ? enabledModelIds
    : DEFAULT_CURATED_CHAT_MODEL_IDS
  const enabled = useMemo(() => new Set(effectiveIds), [effectiveIds])
  const curatedIds = useMemo(() => new Set<string>(DEFAULT_CURATED_CHAT_MODEL_IDS), [])
  const displayModels = useMemo(() => {
    void revision
    void byokConnections
    const gatewayIds = new Set(models.filter((model) => model.type === 'language').map((model) => model.id))
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
    const byokModels: GatewayCatalogModel[] = AVAILABLE_MODELS
      .filter((model) => isByokModelId(model.id))
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
        pricing: {},
      }))
    const combined = [...existingDefaults, ...models, ...byokModels]
    if (modelOrder.length === 0) return combined
    const orderIndex = new Map(modelOrder.map((id, index) => [id, index]))
    return [...combined].sort((a, b) => {
      const aIndex = orderIndex.get(a.id)
      const bIndex = orderIndex.get(b.id)
      if (aIndex === undefined && bIndex === undefined) return 0
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      return aIndex - bIndex
    })
  }, [byokConnections, curatedIds, modelOrder, models, revision])
  const filtered = useMemo(() => {
    const byType = displayModels.filter((model) => model.type === catalogType)
    const normalized = query.trim().toLowerCase()
    if (!normalized) return byType
    return byType.filter((model) =>
      `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(normalized),
    )
  }, [catalogType, displayModels, query])

  function toggle(modelId: string) {
    const next = new Set(effectiveIds)
    if (next.has(modelId)) {
      if (next.size === 1) return
      next.delete(modelId)
    } else {
      next.add(modelId)
    }
    onChange({ enabledChatModelIds: Array.from(next) })
  }

  function moveEnabledModel(modelId: string, direction: -1 | 1) {
    const enabledInDisplayOrder = displayModels
      .map((model) => model.id)
      .filter((id) => enabled.has(id))
    const index = enabledInDisplayOrder.indexOf(modelId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= enabledInDisplayOrder.length) return
    const [moved] = enabledInDisplayOrder.splice(index, 1)
    enabledInDisplayOrder.splice(target, 0, moved)
    const enabledSet = new Set(enabledInDisplayOrder)
    onChange({
      modelOrder: [
        ...enabledInDisplayOrder,
        ...modelOrder.filter((id) => !enabledSet.has(id)),
      ],
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]">
        <div className="flex items-center gap-1 border-b border-[var(--border)] p-2">
          {([
            ['language', 'Chat', MessageSquare],
            ['image', 'Image', ImageIcon],
            ['video', 'Video', Video],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={catalogType === value}
              onClick={() => setCatalogType(value)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                catalogType === value
                  ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon size={13} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
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
          {catalogType === 'language' ? <>
            <button
              type="button"
              aria-label="Refresh models"
              disabled={isLoading}
              onClick={() => { void refresh(); void refreshByok() }}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({
                enabledChatModelIds: [...DEFAULT_CURATED_CHAT_MODEL_IDS],
                modelOrder: [],
              })}
              className="hidden h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs text-[var(--foreground)] sm:block"
            >
              Reset defaults
            </button>
          </> : null}
        </div>
        <div className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          {catalogType === 'language'
            ? `${effectiveIds.length} enabled · ${filtered.length} available chat models`
            : `${filtered.length} priced ${catalogType} models from AI Gateway`}
        </div>
        {error ? <div className="px-4 py-6 text-sm text-red-500">{error}</div> : null}
        {!error ? (
          <div className="max-h-[34rem] divide-y divide-[var(--border)] overflow-y-auto">
            {filtered.map((model: GatewayCatalogModel) => {
              const byok = isByokModelId(model.id)
              const hasUsagePricing =
                model.type === 'language'
                  ? model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined
                  : gatewayCatalogModelHasSupportedPricing(model)
              const mediaDefault = model.type === 'image'
                ? defaultImageModelId === model.id
                : model.type === 'video'
                  ? defaultVideoModelId === model.id
                  : false
              return (
              <div
                key={model.id}
                className={`flex items-center gap-4 px-4 py-3 transition-colors ${
                  hasUsagePricing || byok ? 'hover:bg-[var(--surface-muted)]' : 'opacity-55'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--foreground)]">{model.name}</span>
                    {model.type === 'language' && model.tags.includes('vision') ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                        <ScanEye size={11} strokeWidth={1.6} />
                      </span>
                    ) : null}
                    {model.type === 'language' && model.tags.includes('reasoning') ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[#f0f0f0] text-zinc-700">
                        <Sparkles size={11} strokeWidth={1.6} />
                      </span>
                    ) : null}
                    {model.type !== 'language' ? (
                      <span>{formatMediaPrice(model)}</span>
                    ) : byok ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                        <KeyRound size={10} /> BYOK
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                    <span className="capitalize">{model.provider}</span>
                    <span>·</span>
                    {byok ? (
                      <span>Billed directly by provider</span>
                    ) : hasUsagePricing ? (
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
                {model.type === 'language' && enabled.has(model.id) ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${model.name} up`}
                      disabled={disabled}
                      onClick={() => moveEnabledModel(model.id, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] disabled:opacity-40"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${model.name} down`}
                      disabled={disabled}
                      onClick={() => moveEnabledModel(model.id, 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] disabled:opacity-40"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                ) : null}
                {model.type === 'language' ? (
                  <SettingsToggle
                    checked={enabled.has(model.id)}
                    disabled={
                      disabled ||
                      (!hasUsagePricing && !byok) ||
                      (enabled.has(model.id) && enabled.size === 1)
                    }
                    onChange={() => toggle(model.id)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={disabled || !hasUsagePricing}
                    onClick={() => onChange(model.type === 'image'
                      ? { defaultImageModelId: model.id }
                      : { defaultVideoModelId: model.id })}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      mediaDefault
                        ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]'
                        : 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {mediaDefault ? <Check size={12} /> : null}
                    {mediaDefault ? 'Default' : 'Set default'}
                  </button>
                )}
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
