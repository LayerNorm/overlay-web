'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Archive,
  Bot,
  FileText,
  Folder,
  Hash,
  Loader2,
  MessageCircle,
  MessageSquare,
  NotebookText,
  RotateCcw,
  Server,
  Sparkles,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Button, Input, ListboxSelect } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { ScopeTag } from '@/components/layout/ScopeTag'
import {
  ARCHIVED_CATEGORIES,
  ARCHIVED_CATEGORY_LABELS,
  ARCHIVED_KIND_LABELS,
  filterArchivedItems,
  pruneSelection,
  summarizeBulk,
  type ArchivedCategoryFilter,
  type ArchivedItem,
  type ArchivedItemKind,
} from '../lib/archived-items'
import { deleteArchivedItem, loadArchivedItems, restoreArchivedItem, runBulk } from '../lib/archived-actions'

const KIND_ICONS: Record<ArchivedItemKind, LucideIcon> = {
  chat: MessageSquare,
  file: FileText,
  folder: Folder,
  note: NotebookText,
  agent: Bot,
  'agent-thread': MessageCircle,
  skill: Sparkles,
  'mcp-server': Server,
  automation: Workflow,
}

function archivedOn(timestamp?: number): string {
  // Locale pinned so server and client render the same text.
  return timestamp ? new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

/** What deleting forever means for this selection, said in plain words in the confirmation. */
function deleteDescription(items: readonly ArchivedItem[]): string {
  const parts = ['This cannot be undone.']
  if (items.some((item) => item.kind === 'agent')) {
    parts.push('Deleting an agent also deletes its threads.')
  }
  if (items.some((item) => item.kind === 'agent-thread')) {
    parts.push('Deleting a thread does not affect its agent.')
  }
  if (items.some((item) => item.kind === 'chat' && item.conversationType !== undefined && item.conversationType !== 'personal')) {
    parts.push('Channels and direct messages are removed for you only; other members keep them.')
  }
  if (items.some((item) => item.kind === 'folder')) {
    parts.push('Deleting a folder deletes everything inside it.')
  }
  return parts.join(' ')
}

/**
 * Settings → Archived: everything archived, in one place. Pick a kind from the dropdown or search; restore or delete
 * forever one at a time or many at once. Restore puts an item back where it came from; the server decides who may.
 */
export function ArchivedSettings() {
  const workspaceId = useOptionalWorkspace()?.activeWorkspaceId ?? null
  const [items, setItems] = useState<ArchivedItem[] | null>(null)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const [category, setCategory] = useState<ArchivedCategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<ArchivedItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const lastToggled = useRef<string | null>(null)

  const load = useCallback(async () => {
    const result = await loadArchivedItems(workspaceId)
    setItems(result.items)
    setFailedSources(result.failed.map((source) => ARCHIVED_CATEGORY_LABELS[source].toLowerCase()))
    setSelected((current) => pruneSelection(current, result.items))
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])
  useWorkspaceChanged(load)

  const visible = useMemo(() => filterArchivedItems(items ?? [], category, query), [items, category, query])
  const selectedItems = useMemo(() => (items ?? []).filter((item) => selected.has(item.key)), [items, selected])
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.key))

  function toggle(item: ArchivedItem, shift: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      const turnOn = !current.has(item.key)
      const anchor = shift && lastToggled.current ? visible.findIndex((row) => row.key === lastToggled.current) : -1
      if (anchor >= 0) {
        const here = visible.findIndex((row) => row.key === item.key)
        for (const row of visible.slice(Math.min(anchor, here), Math.max(anchor, here) + 1)) {
          if (turnOn) next.add(row.key)
          else next.delete(row.key)
        }
      } else if (turnOn) next.add(item.key)
      else next.delete(item.key)
      return next
    })
    lastToggled.current = item.key
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current)
      for (const item of visible) {
        if (allVisibleSelected) next.delete(item.key)
        else next.add(item.key)
      }
      return next
    })
  }

  async function restore(targets: ArchivedItem[]) {
    setBusy(true)
    setNotice(null)
    try {
      if (targets.length === 1) {
        await restoreArchivedItem(targets[0]!, workspaceId)
        setNotice({ tone: 'ok', text: `Restored “${targets[0]!.name}”.` })
      } else {
        const outcome = await runBulk(targets, 'restore', workspaceId)
        setNotice({ tone: outcome.failed.length === 0 ? 'ok' : 'error', text: summarizeBulk('restored', outcome) })
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not restore that. You may not have access to it.' })
    } finally {
      setBusy(false)
      await load()
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const targets = pendingDelete
    setBusy(true)
    setNotice(null)
    try {
      if (targets.length === 1) {
        await deleteArchivedItem(targets[0]!, workspaceId)
        setNotice({ tone: 'ok', text: `Deleted “${targets[0]!.name}”.` })
      } else {
        const outcome = await runBulk(targets, 'delete', workspaceId)
        setNotice({ tone: outcome.failed.length === 0 ? 'ok' : 'error', text: summarizeBulk('deleted', outcome) })
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not delete that. You may not have access to it.' })
    } finally {
      setBusy(false)
      setPendingDelete(null)
      await load()
    }
  }

  if (items === null) {
    return (
      <div className="flex min-h-48 items-center justify-center text-[var(--muted)]">
        <Loader2 size={18} className="animate-spin" aria-label="Loading archived items" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Everything you archive lands here. Restore it to put it back, or delete it forever.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <ListboxSelect<ArchivedCategoryFilter>
          value={category}
          options={ARCHIVED_CATEGORIES.map((value) => ({ value, label: ARCHIVED_CATEGORY_LABELS[value] }))}
          aria-label="Show"
          className="shrink-0"
          buttonClassName="min-w-[9.5rem]"
          onChange={setCategory}
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search archived"
          aria-label="Search archived items"
          className="min-w-40 flex-1"
        />
      </div>

      {failedSources.length > 0 ? (
        <p role="alert" className="text-xs text-red-500">
          Could not load archived {failedSources.join(', ')}. The rest are shown below.
        </p>
      ) : null}
      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? 'text-xs text-red-500' : 'text-xs text-[var(--muted)]'}>
          {notice.text}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-6 py-14 text-center">
          <Archive size={28} strokeWidth={1.25} className="text-[var(--muted-light)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--foreground)]">
            {items.length === 0 ? 'Nothing archived' : 'No matches'}
          </p>
          <p className="text-xs text-[var(--muted-light)]">
            {items.length === 0
              ? 'Chats, files, agents, extensions, and automations you archive show up here.'
              : 'Try another kind or search.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]">
          <div className="flex h-10 items-center gap-3 border-b border-[var(--border)] px-3">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              aria-label="Select all shown"
              className="h-3.5 w-3.5 shrink-0 accent-[var(--foreground)]"
            />
            {selectedItems.length > 0 ? (
              <>
                <span className="text-xs text-[var(--foreground)]">{selectedItems.length} selected</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restore(selectedItems)}>
                    <RotateCcw size={13} aria-hidden /> Restore
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => setPendingDelete(selectedItems)}>
                    <Trash2 size={13} aria-hidden /> Delete forever
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                {visible.length === 1 ? '1 item' : `${visible.length} items`}
              </span>
            )}
          </div>
          <ul>
            {visible.map((item) => {
              const Icon = item.kind === 'chat' && item.conversationType === 'channel' ? Hash : KIND_ICONS[item.kind]
              const checked = selected.has(item.key)
              const label = (
                <>
                  <span className="block truncate text-sm text-[var(--foreground)]">{item.name}</span>
                  {item.detail ? <span className="block truncate text-xs text-[var(--muted-light)]">{item.detail}</span> : null}
                </>
              )
              return (
                <li
                  key={item.key}
                  className="group flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0 hover:bg-[var(--surface-subtle)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => undefined}
                    onClick={(event) => toggle(item, event.shiftKey)}
                    aria-label={`Select ${item.name}`}
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--foreground)]"
                  />
                  <Icon size={15} className="shrink-0 text-[var(--muted)]" aria-hidden />
                  {item.href && item.kind === 'chat' ? (
                    <Link href={item.href} className="min-w-0 flex-1">{label}</Link>
                  ) : (
                    <div className="min-w-0 flex-1">{label}</div>
                  )}
                  <span className="hidden w-24 shrink-0 text-right text-xs text-[var(--muted-light)] sm:inline">{ARCHIVED_KIND_LABELS[item.kind]}</span>
                  <span className="flex w-[4.5rem] shrink-0 justify-end">{item.scope ? <ScopeTag scope={item.scope} /> : null}</span>
                  <span className="hidden w-12 shrink-0 text-right text-xs text-[var(--muted-light)] sm:inline">{archivedOn(item.archivedAt)}</span>
                  <button
                    type="button"
                    title="Restore"
                    aria-label={`Restore ${item.name}`}
                    disabled={busy}
                    onClick={() => void restore([item])}
                    className="shrink-0 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    type="button"
                    title="Delete forever"
                    aria-label={`Delete ${item.name} forever`}
                    disabled={busy}
                    onClick={() => setPendingDelete([item])}
                    className="shrink-0 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={
          pendingDelete && pendingDelete.length > 1
            ? `Delete ${pendingDelete.length} items forever?`
            : pendingDelete?.[0] ? `Delete “${pendingDelete[0].name}” forever?` : 'Delete forever?'
        }
        description={pendingDelete ? deleteDescription(pendingDelete) : ''}
        confirmLabel="Delete forever"
        destructive
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
