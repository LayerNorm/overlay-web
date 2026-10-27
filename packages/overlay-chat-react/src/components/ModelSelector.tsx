'use client'

import { useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import { Check, LayoutGrid, Lock, Search, Star } from 'lucide-react'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'
import { ProviderLogo, providerLabel } from '@overlay/ui/ai'
import { GenerationModeToggle } from './GenerationModeToggle'

type GenerationModeToggleProps = ComponentProps<typeof GenerationModeToggle>

export type ModelSelectorItem = { id: string; name: string; provider?: string; sourceLabel?: string; connectionName?: string }

export type ModelSelectorSection<T extends ModelSelectorItem> = {
  id: string
  label: string
  provider?: string
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
  for (const model of models) {
    const provider = model.provider ?? 'other'
    const group = byProvider.get(provider)
    if (group) group.push(model)
    else byProvider.set(provider, [model])
  }
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
    [model.name, model.id, model.provider ? providerLabel(model.provider) : '', model.sourceLabel ?? '', model.connectionName ?? '']
      .some((value) => value.toLowerCase().includes(needle)),
  )
}

export interface ModelSelectorProps<T extends ModelSelectorItem> {
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
    const disabled = isDisabled?.(model) ?? false
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
          <span className="min-w-0 flex-1 truncate" title={model.connectionName ? `${model.name} · ${model.connectionName}` : model.name}>
            <span className="block truncate">{model.name}</span>
            {model.connectionName ? <span className="block truncate text-[10px] font-normal text-(--muted-light)">{model.connectionName}</span> : null}
          </span>
          {model.sourceLabel ? <span className="shrink-0 rounded border border-(--border) px-1.5 py-0.5 text-[9px] font-normal text-(--muted)">{model.sourceLabel}</span> : null}
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
      </div>
    )
  }

  return (
    <div data-slot="model-selector" className="flex min-w-0 flex-col gap-1.5 p-1.5">
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
          <div role="tablist" aria-label="Providers" aria-orientation="vertical" className="flex max-h-80 w-10 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r border-(--border) pr-1">
            {sections.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                type="button"
                role="tab"
                aria-selected={!searching && currentSection.id === section.id}
                aria-label={section.label}
                title={section.label}
                onClick={() => jumpTo(section.id)}
                className={unstyledButton(`flex size-8 shrink-0 items-center justify-center rounded-md ${
                  !searching && currentSection.id === section.id
                    ? 'bg-(--surface-muted) text-(--foreground)'
                    : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
                }`)}
              >
                {section.provider ? (
                  <ProviderLogo provider={section.provider} size={14} />
                ) : section.id === 'recommended' ? (
                  <LayoutGrid size={15} strokeWidth={1.75} />
                ) : (
                  <Star size={13} strokeWidth={1.75} fill="currentColor" />
                )}
              </Button>
            ))}
          </div>
        <div ref={setListRef} className="relative h-80 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {beforeList}
          {searching ? (
            results.length ? (
              results.map((model) => renderRow(model, 'result'))
            ) : (
              <p className="px-2 py-3 text-xs text-(--muted-light)">No models match</p>
            )
          ) : (
              <section aria-label={currentSection.label}>
                <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium text-(--muted-light)">{currentSection.label}</h3>
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
