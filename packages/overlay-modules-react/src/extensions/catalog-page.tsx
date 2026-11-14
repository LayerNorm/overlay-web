'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Plus, Search, SearchX, X, type LucideIcon } from 'lucide-react'
import type { ExtensionCatalogSection } from '@overlay/app-core'
import { matchesExtensionQuery } from '@overlay/app-core/extensions'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Skeleton, cn,
} from '@overlay/ui'

/** A catalog image (with an optional dark-theme variant) or a Lucide glyph. Without one the tile shows the name's initial. */
export type ExtensionCatalogLogo =
  | { kind: 'image'; src?: string | null; darkSrc?: string | null }
  | { kind: 'icon'; icon: LucideIcon }

export interface ExtensionCatalogMenuItem {
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
}

export interface ExtensionCatalogEntry {
  id: string
  name: string
  description?: string
  logo?: ExtensionCatalogLogo
  /** A short state shown after the name only when it needs attention (off, not connected, connection error). */
  status?: { label: string; tone?: 'muted' | 'error' }
  /** The row's trailing action is running (connecting, for example). */
  busy?: boolean
  /** Opens the entry's details or editor. */
  onOpen: () => void
  /** Not yet added: the trailing + button. */
  onAdd?: () => void
  /** Added or created: the trailing ⋯ menu. */
  menu?: readonly ExtensionCatalogMenuItem[]
}

export interface ExtensionCatalogAddOption {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
}

export interface ExtensionCatalogPageProps {
  title: string
  subtitle: string
  /** Plural, lower case: "connectors", "MCP servers". */
  noun: string
  /** Shown in the empty state of the Yours tab. */
  icon: LucideIcon
  /** "Yours" in Personal, "Workspace" in Workspace. */
  yoursLabel: string
  loading?: boolean
  browse: readonly ExtensionCatalogSection<ExtensionCatalogEntry>[]
  yours: readonly ExtensionCatalogSection<ExtensionCatalogEntry>[]
  /** Shown on Browse when it has no sections. */
  browseEmpty?: { title: string; body: string }
  yoursEmpty: { title: string; body: string }
  addOptions?: readonly ExtensionCatalogAddOption[]
  /** The open Browse section (its full list), or null for the overview. */
  category: string | null
  onCategoryChange: (category: string | null) => void
  onQueryChange?: (query: string) => void
  /** A search beyond the loaded entries is still running; no-results waits for it. */
  searching?: boolean
  noResults: { body: string; action?: { label: string; onSelect: () => void } }
  /** Rows each Browse section shows before its full view. */
  previewCount?: number
}

export function ExtensionCatalogLogoTile({ name, logo }: { name: string; logo?: ExtensionCatalogLogo }) {
  const [failed, setFailed] = useState<string | null>(null)
  const tile = 'inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]'
  if (logo?.kind === 'icon') {
    const Icon = logo.icon
    return <span aria-hidden className={cn(tile, 'bg-(--shell-fill,var(--surface-subtle)) text-(--foreground)')}><Icon size={18} strokeWidth={1.6} /></span>
  }
  const src = logo?.kind === 'image' ? logo.src : null
  if (!src || failed === src) {
    return <span aria-hidden className={cn(tile, 'bg-(--shell-fill,var(--surface-subtle)) text-base font-semibold text-(--foreground)')}>{name.trim().charAt(0).toUpperCase() || '?'}</span>
  }
  const darkSrc = logo?.kind === 'image' ? logo.darkSrc : null
  return (
    <span aria-hidden className={cn(tile, 'border border-(--border) bg-white dark:bg-(--shell-panel,var(--surface-elevated))')}>
      <img src={src} alt="" width={22} height={22} className={cn('size-[22px] object-contain', darkSrc ? 'dark:hidden' : null)} onError={() => setFailed(src)} />
      {darkSrc ? <img src={darkSrc} alt="" width={22} height={22} className="hidden size-[22px] object-contain dark:block" /> : null}
    </span>
  )
}

export function ExtensionCatalogRow({ entry }: { entry: ExtensionCatalogEntry }) {
  const action = 'absolute right-2 text-(--muted) hover:bg-(--shell-selected,var(--surface-muted)) hover:text-(--foreground)'
  return (
    <div data-slot="extension-row" className="relative flex min-w-0 items-center rounded-xl hover:bg-(--shell-fill,var(--surface-subtle))">
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-3.5 rounded-xl bg-transparent py-2.5 pr-[52px] pl-2.5 text-left font-normal text-inherit hover:bg-transparent hover:text-inherit max-md:pr-12 max-md:pl-1.5"
        onClick={entry.onOpen}
      >
        <ExtensionCatalogLogoTile name={entry.name} logo={entry.logo} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm leading-5 font-medium text-(--foreground)">{entry.name}</span>
            {entry.status ? <span className={cn('shrink-0 text-xs', entry.status.tone === 'error' ? 'text-red-500' : 'text-(--muted-light)')}>{entry.status.label}</span> : null}
          </span>
          {entry.description ? <span className="truncate text-[13px] leading-[18px] text-(--muted)">{entry.description}</span> : null}
        </span>
      </Button>
      {entry.busy ? (
        <Button variant="ghost" size="icon-sm" className={action} disabled aria-label={`Working on ${entry.name}`}><Loader2 size={16} className="animate-spin" /></Button>
      ) : entry.menu?.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className={action} aria-label={`${entry.name} options`}><MoreHorizontal size={16} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {entry.menu.map(item => (
              <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect}><item.icon size={14} />{item.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : entry.onAdd ? (
        <Button variant="ghost" size="icon-sm" className={action} aria-label={`Add ${entry.name}`} onClick={entry.onAdd}><Plus size={17} /></Button>
      ) : null}
    </div>
  )
}

export function ExtensionCatalogGrid({ entries }: { entries: readonly ExtensionCatalogEntry[] }) {
  return <div className="grid grid-cols-2 gap-x-7 gap-y-0.5 max-md:grid-cols-1">{entries.map(entry => <ExtensionCatalogRow key={entry.id} entry={entry} />)}</div>
}

export function ExtensionCatalogSectionView({ title, count, onOpen, children }: { title: string; count?: number; onOpen?: () => void; children: ReactNode }) {
  const heading = <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
  return (
    <section className="pt-[22px]">
      {onOpen ? (
        <Button variant="ghost" className="mb-2 -ml-2 h-8 gap-1 rounded-lg px-2 font-normal text-(--foreground) hover:text-(--foreground)" onClick={onOpen}>
          {heading}<ChevronRight size={16} className="text-(--muted)" />
        </Button>
      ) : (
        <div className="mb-2 flex h-8 items-center gap-2">{heading}{count !== undefined ? <span className="text-[13px] text-(--muted-light)">{count}</span> : null}</div>
      )}
      {children}
    </section>
  )
}

export function ExtensionCatalogEmpty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: { label: string; onSelect: () => void } }) {
  return (
    <div className="flex flex-col items-center px-4 py-[72px] text-center">
      <span className="mb-3.5 inline-flex size-11 items-center justify-center rounded-xl bg-(--shell-fill,var(--surface-subtle)) text-(--muted)"><Icon size={20} /></span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 mb-4 max-w-[340px] text-[13px] leading-normal text-(--muted)">{body}</p>
      {action ? <Button variant="secondary" size="sm" onClick={action.onSelect}>{action.label}</Button> : null}
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-7 gap-y-0.5 pt-[22px] max-md:grid-cols-1" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3.5 p-2.5">
          <Skeleton className="size-10 rounded-[10px]" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-44" /></div>
        </div>
      ))}
    </div>
  )
}

function uniqueEntries(sections: readonly ExtensionCatalogSection<ExtensionCatalogEntry>[]): ExtensionCatalogEntry[] {
  const seen = new Map<string, ExtensionCatalogEntry>()
  for (const section of sections) for (const entry of section.items) if (!seen.has(entry.id)) seen.set(entry.id, entry)
  return [...seen.values()]
}

/**
 * The shared Extensions catalog page (Connectors, Skills, MCPs, Apps): a title with search and Add, Browse and Yours
 * tabs, Browse sections that open a full category view, and search across everything the page lists.
 */
export function ExtensionCatalogPage({
  title, subtitle, noun, icon, yoursLabel, loading, browse, yours, browseEmpty, yoursEmpty, addOptions,
  category, onCategoryChange, onQueryChange, searching, noResults, previewCount = 6,
}: ExtensionCatalogPageProps) {
  const [tab, setTab] = useState<'browse' | 'yours'>('browse')
  const [query, setQuery] = useState('')
  const changeQuery = (next: string) => { setQuery(next); onQueryChange?.(next) }
  const q = query.trim()
  const openSection = category ? browse.find(section => section.id === category) : undefined
  const inCategory = Boolean(openSection && !q)

  let body: ReactNode
  if (loading) {
    body = <CatalogSkeleton />
  } else if (q) {
    const results = uniqueEntries([...yours, ...browse]).filter(entry => matchesExtensionQuery(q, entry.name, entry.description))
    body = results.length
      ? <ExtensionCatalogSectionView title="Results" count={results.length}><ExtensionCatalogGrid entries={results} /></ExtensionCatalogSectionView>
      : searching
        ? <CatalogSkeleton />
        : <ExtensionCatalogEmpty icon={SearchX} title={`No ${noun} match “${q}”`} body={noResults.body} action={noResults.action} />
  } else if (openSection) {
    body = <section className="pt-[22px]"><ExtensionCatalogGrid entries={openSection.items} /></section>
  } else if (tab === 'browse') {
    body = browse.length
      ? browse.map(section => (
        <ExtensionCatalogSectionView key={section.id} title={section.title} onOpen={() => onCategoryChange(section.id)}>
          <ExtensionCatalogGrid entries={section.items.slice(0, previewCount)} />
        </ExtensionCatalogSectionView>
      ))
      : <ExtensionCatalogEmpty icon={icon} title={browseEmpty?.title ?? `No ${noun} to browse`} body={browseEmpty?.body ?? ''} />
  } else {
    body = yours.some(section => section.items.length)
      ? yours.filter(section => section.items.length).map(section => (
        <ExtensionCatalogSectionView key={section.id} title={section.title}><ExtensionCatalogGrid entries={section.items} /></ExtensionCatalogSectionView>
      ))
      : <ExtensionCatalogEmpty icon={icon} title={yoursEmpty.title} body={yoursEmpty.body} action={browse.length ? { label: `Browse ${noun}`, onSelect: () => setTab('browse') } : undefined} />
  }

  return (
    <div className="mx-auto max-w-[920px] px-10 pt-7 pb-14 max-lg:px-6 max-lg:pt-6 max-lg:pb-12 max-md:px-3.5 max-md:pt-4 max-md:pb-10">
      <div className="mb-[18px] flex items-start justify-between gap-6 max-[860px]:flex-col max-[860px]:gap-3.5">
        <div className="flex min-w-0 items-start gap-1.5">
          {inCategory ? (
            <Button variant="ghost" size="icon-sm" className="-ml-2.5 text-(--muted)" aria-label={`Back to ${title}`} onClick={() => onCategoryChange(null)}><ChevronLeft size={18} /></Button>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-[22px] leading-8 font-semibold tracking-[-0.015em]">{inCategory ? openSection!.title : title}</h1>
            <p className="mt-0.5 text-sm text-(--muted)">{inCategory ? `${openSection!.items.length} ${noun}` : subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5 max-[860px]:w-full">
          <div className="relative flex w-60 items-center max-[860px]:w-auto max-[860px]:flex-1">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-[11px] text-(--muted)" />
            <Input
              type="search"
              value={query}
              onChange={event => changeQuery(event.target.value)}
              placeholder={`Search ${noun}`}
              aria-label={`Search ${noun}`}
              className="h-9 rounded-[10px] bg-transparent pr-[30px] pl-[33px] text-[13px] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? <Button variant="ghost" size="icon-xs" className="absolute right-1.5 text-(--muted)" aria-label="Clear search" onClick={() => changeQuery('')}><X size={14} /></Button> : null}
          </div>
          {addOptions?.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="md" className="h-9 gap-1.5 rounded-[10px] pr-2.5 pl-3 text-[13px] max-md:w-9 max-md:p-0" aria-label={`Add ${noun}`}>
                  <Plus size={15} /><span className="max-md:hidden">Add</span><ChevronDown size={13} className="-ml-px text-(--muted) max-md:hidden" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {addOptions.map(option => <DropdownMenuItem key={option.id} onSelect={option.onSelect}><option.icon size={14} />{option.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {!q && !inCategory ? (
        <div role="tablist" aria-label={`${title} views`} className="-ml-0.5 mb-1.5 flex gap-1">
          {(['browse', 'yours'] as const).map(id => (
            <Button
              key={id}
              role="tab"
              aria-selected={tab === id}
              variant="ghost"
              size="sm"
              data-active={tab === id || undefined}
              className="h-8 rounded-full px-3.5 text-[13px] font-[450] text-(--muted) data-active:bg-(--shell-fill,var(--surface-subtle)) data-active:text-(--foreground)"
              onClick={() => setTab(id)}
            >
              {id === 'browse' ? 'Browse' : yoursLabel}
            </Button>
          ))}
        </div>
      ) : null}
      {body}
    </div>
  )
}

/** Confirms deleting a skill or MCP server chosen from a row's menu. */
export function ExtensionCatalogDeleteDialog({ name, kind, onCancel, onConfirm }: { name: string; kind: 'server' | 'skill'; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open onOpenChange={open => { if (!open) onCancel() }}>
      <AlertDialogContent className="w-[min(440px,calc(100vw-2rem))] p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6">This {kind}{kind === 'server' ? ' and its tools' : ''} will no longer be available to your agents. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={onConfirm}>Delete {kind}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
