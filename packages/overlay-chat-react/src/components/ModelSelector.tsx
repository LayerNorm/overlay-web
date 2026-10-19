'use client'

import { useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import { Check, Search, Star } from 'lucide-react'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'
import { ProviderLogo, providerLabel } from '@overlay/ui/ai'
import { GenerationModeToggle } from './GenerationModeToggle'

type GenerationModeToggleProps = ComponentProps<typeof GenerationModeToggle>

export type ModelSelectorItem = { id: string; name: string; provider?: string }

export type ModelSelectorSection<T extends ModelSelectorItem> = {
  id: string
  label: string
  provider?: string
  models: T[]
}

/** Pinned first, then favorites, then one section per provider in the order their best model appears. */
export function groupModelsByProvider<T extends ModelSelectorItem>(
  models: readonly T[],
  { pinnedIds = [], favoriteIds = [] }: { pinnedIds?: readonly string[]; favoriteIds?: readonly string[] } = {},
): ModelSelectorSection<T>[] {
  const pinned = new Set(pinnedIds)
  const sections: ModelSelectorSection<T>[] = []
  const pinnedModels = models.filter((model) => pinned.has(model.id))
  if (pinnedModels.length) sections.push({ id: 'pinned', label: 'Suggested', models: pinnedModels })
  const favorites = new Set(favoriteIds)
  const favoriteModels = models.filter((model) => favorites.has(model.id))
  if (favoriteModels.length) sections.push({ id: 'favorites', label: 'Favorites', models: favoriteModels })
  const byProvider = new Map<string, T[]>()
  for (const model of models) {
    if (pinned.has(model.id)) continue
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
    [model.name, model.id, model.provider ? providerLabel(model.provider) : '']
      .some((value) => value.toLowerCase().includes(needle)),
  )
}

export interface ModelSelectorProps<T extends ModelSelectorItem> {
  mode?: GenerationModeToggleProps['mode']
  onModeChange?: GenerationModeToggleProps['onChange']
  modeDisabled?: boolean
  models: readonly T[]
  pinnedIds?: readonly string[]
  favoriteIds: readonly string[]
  onToggleFavorite: (modelId: string) => void
  isSelected: (model: T) => boolean
  isDisabled?: (model: T) => boolean
  onSelect: (model: T) => void
  renderBadges?: (model: T) => ReactNode
  onRowHover?: (model: T, row: HTMLElement) => void
  listRef?: Ref<HTMLDivElement>
  beforeList?: ReactNode
  footer?: ReactNode
}

export function ModelSelector<T extends ModelSelectorItem>({
  mode,
  onModeChange,
  modeDisabled,
  models,
  pinnedIds,
  favoriteIds,
  onToggleFavorite,
  isSelected,
  isDisabled,
  onSelect,
  renderBadges,
  onRowHover,
  listRef,
  beforeList,
  footer,
}: ModelSelectorProps<T>) {
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const searching = query.trim().length > 0
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const sections = useMemo(
    () => (searching ? [] : groupModelsByProvider(models, { pinnedIds, favoriteIds })),
    [favoriteIds, models, pinnedIds, searching],
  )
  const results = useMemo(() => (searching ? filterModels(models, query) : []), [models, query, searching])
  const railSections = sections.filter((section) => section.id !== 'pinned')
  const showRail = !searching && railSections.length > 1
  const currentSection = activeSection ?? railSections[0]?.id ?? null

  const setListRef = (node: HTMLDivElement | null) => {
    scrollRef.current = node
    assignRef(listRef, node)
  }

  const jumpTo = (sectionId: string) => {
    const list = scrollRef.current
    const section = sectionRefs.current.get(sectionId)
    if (!list || !section) return
    list.scrollTo({ top: section.offsetTop })
    setActiveSection(sectionId)
  }

  const onListScroll = () => {
    const list = scrollRef.current
    if (!list || !showRail) return
    let next = railSections[0]?.id ?? null
    for (const section of railSections) {
      const node = sectionRefs.current.get(section.id)
      if (node && node.offsetTop <= list.scrollTop + 8) next = section.id
    }
    setActiveSection(next)
  }

  const renderRow = (model: T, keyPrefix: string) => {
    const selected = isSelected(model)
    const favorite = favoriteSet.has(model.id)
    const disabled = isDisabled?.(model) ?? false
    return (
      <div
        key={`${keyPrefix}:${model.id}`}
        data-model-row={model.id}
        onMouseEnter={onRowHover ? (event) => onRowHover(model, event.currentTarget) : undefined}
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
          className={unstyledButton(`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs ${
            disabled ? 'cursor-not-allowed' : ''
          } ${selected ? 'font-medium text-(--foreground)' : 'text-(--muted)'}`)}
        >
          <ProviderLogo provider={model.provider ?? 'other'} size={14} className="text-(--foreground)" />
          <span className="min-w-0 truncate">{model.name}</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-label={favorite ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(model.id)}
          data-slot="model-favorite"
          className={unstyledButton(`flex size-5 shrink-0 items-center justify-center rounded-sm text-(--muted-light) hover:text-(--foreground) ${
            favorite ? 'text-(--foreground)' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'
          }`)}
        >
          <Star size={11} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
        </Button>
        <span data-slot="model-selected" className="flex size-4 shrink-0 items-center justify-center text-(--foreground)">
          {selected ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : null}
        </span>
        {renderBadges ? <span className="flex shrink-0 items-center gap-1">{renderBadges(model)}</span> : null}
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
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          className={unstyledInput('min-w-0 flex-1 bg-transparent text-xs text-(--foreground) outline-none placeholder:text-(--muted-light)')}
        />
      </label>
      <div className="flex min-h-0 gap-1">
        {showRail ? (
          <div role="tablist" aria-label="Providers" className="flex w-8 shrink-0 flex-col items-center gap-0.5 overflow-y-auto">
            {railSections.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                type="button"
                role="tab"
                aria-selected={currentSection === section.id}
                aria-label={section.label}
                title={section.label}
                onClick={() => jumpTo(section.id)}
                className={unstyledButton(`flex size-7 items-center justify-center rounded-md ${
                  currentSection === section.id
                    ? 'bg-(--surface-muted) text-(--foreground)'
                    : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
                }`)}
              >
                {section.provider ? (
                  <ProviderLogo provider={section.provider} size={14} />
                ) : (
                  <Star size={13} strokeWidth={1.75} fill="currentColor" />
                )}
              </Button>
            ))}
          </div>
        ) : null}
        <div ref={setListRef} onScroll={onListScroll} className="relative max-h-80 min-w-0 flex-1 overflow-y-auto">
          {beforeList}
          {searching ? (
            results.length ? (
              results.map((model) => renderRow(model, 'result'))
            ) : (
              <p className="px-2 py-3 text-xs text-(--muted-light)">No models match</p>
            )
          ) : (
            sections.map((section) => (
              <section
                key={section.id}
                ref={(node) => {
                  if (node) sectionRefs.current.set(section.id, node)
                  else sectionRefs.current.delete(section.id)
                }}
                aria-label={section.label}
              >
                {section.id === 'pinned' ? null : (
                  <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium text-(--muted-light)">{section.label}</h3>
                )}
                {section.models.map((model) => renderRow(model, section.id))}
              </section>
            ))
          )}
        </div>
      </div>
      {footer}
    </div>
  )
}
