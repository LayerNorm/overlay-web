'use client'

import type {
ExtensionCatalogItem
} from '@overlay/app-core'
import { extensionCatalogItemKey } from '@overlay/app-core/extensions'
import { Badge,EmptyState,Toggle,cn } from '@overlay/ui'
import { type ReactNode } from 'react'

export interface ExtensionCatalogProps {
  items: readonly ExtensionCatalogItem[]
  activeKind?: ExtensionCatalogItem['kind'] | 'all'
  loading?: boolean
  policyDisabledIds?: ReadonlySet<string>
  onSelectItem?: (item: ExtensionCatalogItem) => void
  onToggleSkill?: (item: Extract<ExtensionCatalogItem, { kind: 'skill' }>, enabled: boolean) => void
  onToggleMcp?: (item: Extract<ExtensionCatalogItem, { kind: 'mcp' }>, enabled: boolean) => void
  renderActions?: (item: ExtensionCatalogItem) => ReactNode
}

export function ExtensionCatalog({
  items,
  activeKind = 'all',
  loading,
  policyDisabledIds,
  onSelectItem,
  onToggleSkill,
  onToggleMcp,
  renderActions,
}: ExtensionCatalogProps) {
  const visibleItems = activeKind === 'all' ? items : items.filter((item) => item.kind === activeKind)

  if (loading) return <div className="p-4 text-xs text-[var(--muted)]">Loading extensions...</div>
  if (visibleItems.length === 0) return <EmptyState className="h-full min-h-48" title="No extensions found" />

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {visibleItems.map((item) => {
        const itemKey = extensionCatalogItemKey(item)
        const disabledByPolicy = policyDisabledIds?.has(itemKey) ?? false
        const label = 'name' in item ? item.name : item.label
        const description = 'description' in item ? item.description : undefined
        return (
          <article
            key={`${item.kind}:${itemKey}`}
            className={cn(
              'rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3',
              disabledByPolicy ? 'opacity-60' : '',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={disabledByPolicy}
                onClick={() => onSelectItem?.(item)}
              >
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <Badge variant="muted">{item.kind}</Badge>
                </div>
                {description ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{description}</p>
                ) : null}
              </button>
              {item.kind === 'skill' && onToggleSkill ? (
                <Toggle checked={item.enabled !== false} onCheckedChange={(checked) => onToggleSkill(item, checked)} />
              ) : null}
              {item.kind === 'mcp' && onToggleMcp ? (
                <Toggle checked={item.enabled} onCheckedChange={(checked) => onToggleMcp(item, checked)} />
              ) : null}
            </div>
            <div className="mt-3 flex min-h-8 items-center justify-between gap-2">
              <StatusBadge item={item} disabledByPolicy={disabledByPolicy} />
              {renderActions ? <div className="flex items-center gap-2">{renderActions(item)}</div> : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function StatusBadge({ item, disabledByPolicy }: { item: ExtensionCatalogItem; disabledByPolicy: boolean }) {
  if (disabledByPolicy) return <Badge variant="warning">Policy gated</Badge>
  if (item.kind === 'integration') {
    return <Badge variant={item.isConnected ? 'success' : 'muted'}>{item.isConnected ? 'Connected' : 'Available'}</Badge>
  }
  if (item.kind === 'skill') {
    return <Badge variant={item.enabled === false ? 'muted' : 'success'}>{item.enabled === false ? 'Off' : 'On'}</Badge>
  }
  if (item.kind === 'mcp') {
    return <Badge variant={item.enabled ? 'success' : 'muted'}>{item.enabled ? 'On' : 'Off'}</Badge>
  }
  return <Badge variant="muted">{item.kind === 'modelProvider' ? 'Provider' : 'Registered'}</Badge>
}
