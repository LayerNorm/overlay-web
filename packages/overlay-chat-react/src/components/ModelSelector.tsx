'use client'

import { useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import { Check, LayoutGrid, Lock, Plug, ScanEye, Search, Star } from 'lucide-react'
import type { ReasoningLevel } from '@overlay/chat-core'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'
import { ProviderLogo, providerLabel } from '@overlay/ui/ai'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { GenerationModeToggle } from './GenerationModeToggle'
import { ModelReasoningControl, type ModelReasoningProps } from './ModelReasoningControl'

type GenerationModeToggleProps = ComponentProps<typeof GenerationModeToggle>

export type ModelSelectorItem = {
  id: string
  name: string
  provider?: string
  sourceLabel?: string
  connectionName?: string
  supportsVision?: boolean
  supportsReasoning?: boolean
  reasoningLevels?: readonly { value: ReasoningLevel; label: string }[]
  subscription?: { connectionId: string; scopeLabel: string; unavailable?: boolean; recoveryHref: string }
}

export function ModelProviderLogo({ model, size = 14 }: { model: Pick<ModelSelectorItem, 'provider' | 'subscription'>; size?: number }) {
  return <span className="relative inline-flex shrink-0 text-(--foreground)">
    <ProviderLogo provider={model.provider ?? 'other'} size={size} />
    {model.subscription ? <span className="absolute -bottom-1 -right-1 rounded-sm bg-(--surface-elevated) ring-2 ring-(--surface-elevated)" data-slot="subscription-badge"><Plug size={10} strokeWidth={1.75} aria-hidden="true" /></span> : null}
  </span>
}

function SubscriptionRecovery({ model }: { model: ModelSelectorItem }) {
  if (!model.subscription?.unavailable) return null
  return <div className="mx-1 mb-2 rounded-md bg-(--surface-muted) p-2.5 text-xs leading-relaxed text-(--muted)">
    <p>{model.connectionName} needs to be reconnected. No alternate model will be used.</p>
    <Button asChild variant="link" className="h-auto p-0 text-xs"><a href={model.subscription.recoveryHref}>Reconnect {model.connectionName}</a></Button>
  </div>
}

export type ModelSelectorSection<T extends ModelSelectorItem> = {
  id: string
  label: string
  provider?: string
  subscription?: ModelSelectorItem['subscription']
  models: T[]
}

/** Collections never remove models from their provider's catalog. */
export function groupModelsByProvider<T extends ModelSelectorItem>(
  models: readonly T[],
  { pinnedIds = [], favoriteIds = [], recommendedIds = [] }: {
    pinnedIds?: readonly string[]; favoriteIds?: readonly string[]; recommendedIds?: readonly string[]
  } = {},
): ModelSelectorSection<T>[] {
  const pinned = new Set(pinnedIds)
  const favorites = new Set(favoriteIds)
  const recommended = new Set(recommendedIds)
  const sections: ModelSelectorSection<T>[] = [
    { id: 'favorites', label: 'Favorites', models: models.filter((model) => favorites.has(model.id)) },
    { id: 'recommended', label: 'Recommended', models: [
      ...models.filter((model) => pinned.has(model.id)),
      ...models.filter((model) => recommended.has(model.id) && !pinned.has(model.id)),
    ] },
  ]
  const byProvider = new Map<string, T[]>()
  const subscriptions = new Map<string, ModelSelectorSection<T>>()
  for (const model of models) {
    if (model.subscription) {
      const id = `subscription:${model.subscription.connectionId}`
      const group = subscriptions.get(id)
      if (group) group.models.push(model)
      else subscriptions.set(id, { id, label: `${model.connectionName ?? providerLabel(model.provider ?? 'other')} subscription`, provider: model.provider, subscription: model.subscription, models: [model] })
      continue
    }
    const provider = model.provider ?? 'other'
    const group = byProvider.get(provider)
    if (group) group.push(model)
    else byProvider.set(provider, [model])
  }
  sections.push(...subscriptions.values())
  for (const [provider, group] of byProvider) {
    sections.push({ id: `provider:${provider}`, label: providerLabel(provider), provider, models: group })
  }
  return sections
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}

export function filterModels<T extends ModelSelectorItem>(models: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...models]
  return models.filter((model) =>
    [model.name, model.id, model.provider ? providerLabel(model.provider) : '', model.sourceLabel ?? '', model.connectionName ?? '', model.subscription?.scopeLabel ?? '']
      .some((value) => value.toLowerCase().includes(needle)),
  )
}

export interface ModelSelectorProps<T extends ModelSelectorItem> extends ModelReasoningProps {
  mode?: GenerationModeToggleProps['mode']
  onModeChange?: GenerationModeToggleProps['onChange']
  modeDisabled?: boolean
  models: readonly T[]
  pinnedIds?: readonly string[]
  recommendedIds?: readonly string[]
  favoriteIds: readonly string[]
  onToggleFavorite: (modelId: string) => void
  isSelected: (model: T) => boolean
  isLocked?: (model: T) => boolean
  isDisabled?: (model: T) => boolean
  onSelect: (model: T) => void
  onRowHover?: (model: T, row: HTMLElement) => void
  onListChange?: () => void
  listRef?: Ref<HTMLDivElement>
  searchInputRef?: Ref<HTMLInputElement>
  beforeList?: ReactNode
  footer?: ReactNode
  showReasoning?: boolean
}

function ModelRowLabel({ model, showConnection }: { model: ModelSelectorItem; showConnection: boolean }) {
  return <>
    <span className="min-w-0 flex-1 truncate" title={model.connectionName ? `${model.name} · ${model.connectionName}` : model.name}>
      <span className="block truncate">{model.name}</span>
      {model.connectionName && showConnection ? <span className="block truncate text-[10px] font-normal text-(--muted-light)">{model.connectionName}{model.subscription ? ` · ${model.subscription.scopeLabel}` : ''}</span> : null}
    </span>
    {model.sourceLabel && !model.subscription ? <span className="shrink-0 rounded border border-(--border) px-1.5 py-0.5 text-[9px] font-normal text-(--muted)">{model.sourceLabel}</span> : null}
  </>
}

export function ModelSelector<T extends ModelSelectorItem>({
  mode,
  onModeChange,
  modeDisabled,
  models,
  pinnedIds,
  recommendedIds,
  favoriteIds,
  onToggleFavorite,
  isSelected,
  isLocked,
  isDisabled,
  onSelect,
  onRowHover,
  onListChange,
  listRef,
  searchInputRef,
  beforeList,
  footer,
  reasoningByModel,
  onModelReasoningChange,
  showReasoning = Boolean(onModelReasoningChange),
}: ModelSelectorProps<T>) {
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState('recommended')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const searching = query.trim().length > 0
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const sections = useMemo(
    () => groupModelsByProvider(models, { pinnedIds, favoriteIds, recommendedIds }),
    [favoriteIds, models, pinnedIds, recommendedIds],
  )
  const results = useMemo(() => (searching ? filterModels(models, query) : []), [models, query, searching])
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[1]!
  const visibleModels = searching ? results : currentSection.models
  const recoveryModels = [...new Map(visibleModels.filter((model) => model.subscription?.unavailable)
    .map((model) => [model.subscription!.connectionId, model])).values()]

  const setListRef = (node: HTMLDivElement | null) => {
    scrollRef.current = node
    assignRef(listRef, node)
  }

  const jumpTo = (sectionId: string) => {
    onListChange?.()
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setQuery('')
    setActiveSection(sectionId)
  }

  const renderRow = (model: T, keyPrefix: string) => {
    const selected = isSelected(model)
    const locked = !selected && (isLocked?.(model) ?? false)
    const favorite = favoriteSet.has(model.id)
    const disabled = Boolean(model.subscription?.unavailable) || (isDisabled?.(model) ?? false)
    return (
      <div
        key={`${keyPrefix}:${model.id}`}
        data-model-row={model.id}
        onMouseEnter={onRowHover ? (event) => onRowHover(model, event.currentTarget) : undefined}
        onFocus={onRowHover ? (event) => onRowHover(model, event.currentTarget) : undefined}
        className={`group/row flex items-center gap-1 rounded-md pr-1.5 ${
          disabled ? 'opacity-40' : 'hover:bg-(--surface-muted)'
        }`}
      >
        <Button
          variant="ghost"
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          onClick={() => onSelect(model)}
          className={unstyledButton(`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left text-[13px] ${
            disabled ? 'cursor-not-allowed' : ''
          } ${selected ? 'font-medium text-(--foreground)' : 'text-(--muted)'}`)}
        >
          <ProviderLogo provider={model.provider ?? 'other'} size={14} className="text-(--foreground)" />
          <ModelRowLabel model={model} showConnection={!model.subscription || searching || currentSection.id === 'favorites' || currentSection.id === 'recommended'} />
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-label={favorite ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
          aria-pressed={favorite}
          onClick={() => {
            onListChange?.()
            onToggleFavorite(model.id)
          }}
          data-slot="model-favorite"
          className={unstyledButton(`flex size-5 shrink-0 items-center justify-center rounded-sm text-(--muted-light) hover:text-(--foreground) ${
            favorite ? 'text-(--foreground)' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100'
          }`)}
        >
          <Star size={11} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
        </Button>
        <span data-slot="model-selected" className={`flex size-4 shrink-0 items-center justify-center ${locked ? 'text-(--muted-light)' : 'text-(--foreground)'}`}>
          {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : null}
          {locked ? <span title="Paid plan" className="inline-flex"><Lock size={11} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">Paid plan</span></span> : null}
        </span>
        <span className="flex shrink-0 gap-1">
          {model.supportsVision ? <span title="Vision" className="inline-flex size-4 items-center justify-center rounded bg-(--surface-muted) text-(--muted)"><ScanEye size={11} strokeWidth={1.75} /><span className="sr-only">Vision</span></span> : null}
        </span>
        {showReasoning ? <ModelReasoningControl model={model} value={reasoningByModel?.[model.id]} disabled={disabled || Boolean(isLocked?.(model))}
          onChange={onModelReasoningChange ? (level) => onModelReasoningChange(model.id, level) : undefined} /> : null}
      </div>
    )
  }

  return (
    <div data-slot="model-selector" className="flex min-w-0 flex-col gap-1.5 p-1.5" onKeyDown={(event) => {
      if (event.defaultPrevented || (event.target as HTMLElement).closest('[data-slot="model-reasoning"]')) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-row] > button:first-child:not(:disabled)')]
      if (!rows.length) return
      const index = rows.indexOf(event.target as HTMLButtonElement)
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      rows[next]?.focus()
      event.preventDefault()
    }}>
      {mode && onModeChange ? (
        <GenerationModeToggle mode={mode} onChange={onModeChange} disabled={modeDisabled} layout="stretch" />
      ) : null}
      <label className="flex items-center gap-2 rounded-md bg-(--surface-subtle) px-2 py-1.5 text-xs text-(--muted)">
        <Search size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <Input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(event) => {
            onListChange?.()
            setQuery(event.target.value)
          }}
          placeholder="Search models"
          aria-label="Search models"
          className={unstyledInput('min-w-0 flex-1 bg-transparent text-xs text-(--foreground) outline-none placeholder:text-(--muted-light)')}
        />
      </label>
      <div className="flex min-h-0 gap-1">
          <div aria-label="Model groups" className="flex max-h-80 w-10 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pr-1">
            {sections.map((section) => (
              <DelayedTooltip key={section.id} label={`${section.label}${section.subscription ? ` · ${section.subscription.scopeLabel}` : ''}`} side="right">
              <Button
                key={section.id}
                variant="ghost"
                type="button"
                aria-label={`${section.label}${section.subscription ? ` · ${section.subscription.scopeLabel}` : ''}`}
                aria-pressed={!searching && currentSection.id === section.id}
                onClick={() => jumpTo(section.id)}
                className={unstyledButton(`flex size-8 shrink-0 items-center justify-center rounded-md ${
                  !searching && currentSection.id === section.id
                    ? 'bg-(--surface-muted) text-(--foreground)'
                    : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
                }`)}
              >
                {section.provider ? (
                  <ModelProviderLogo model={section} />
                ) : section.id === 'recommended' ? (
                  <LayoutGrid size={15} strokeWidth={1.75} />
                ) : (
                  <Star size={13} strokeWidth={1.75} fill="currentColor" />
                )}
              </Button>
              </DelayedTooltip>
            ))}
          </div>
        <div ref={setListRef} className="relative h-80 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {beforeList}
          {recoveryModels.map((model) => <SubscriptionRecovery key={model.subscription!.connectionId} model={model} />)}
          {searching ? (
            results.length ? (
              results.map((model) => renderRow(model, 'result'))
            ) : (
              <p className="px-2 py-3 text-xs text-(--muted-light)">No models match</p>
            )
          ) : (
              <section aria-label={currentSection.label}>
                <h3 className="flex items-center gap-2 px-2 pb-2 pt-2 text-[11px] font-medium text-(--muted-light)"><span className="min-w-0 truncate">{currentSection.label}</span>{currentSection.subscription ? <span className="ml-auto shrink-0 text-[10px] font-normal">{currentSection.subscription.scopeLabel}</span> : null}</h3>
                {currentSection.models.map((model) => renderRow(model, currentSection.id))}
                {currentSection.models.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-(--muted-light)">
                    {currentSection.id === 'favorites' ? 'Star a model to save it here.' : 'No models available'}
                  </p>
                ) : null}
              </section>
          )}
        </div>
      </div>
      {footer}
    </div>
  )
}
