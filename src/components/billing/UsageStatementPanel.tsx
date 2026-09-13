'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Loader2, ReceiptText } from 'lucide-react'
import {
  USAGE_STATEMENT_CATEGORY_LABELS,
  USAGE_STATEMENT_DEFAULT_LINES,
  type UsageStatement,
  type UsageStatementCategory,
  type UsageStatementLine,
  type UsageStatementLinesPage,
} from '@/shared/billing/usage-statement'

type StatementState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; statement: UsageStatement }

type ExtraLines = {
  hasMore: boolean
  lines: UsageStatementLine[]
  loading: boolean
}

export function UsageStatementPanel({ endpoint }: { endpoint: string }) {
  const [state, setState] = useState<StatementState>({ status: 'loading' })
  const [expanded, setExpanded] = useState<ReadonlySet<UsageStatementCategory>>(new Set())
  const [extraLines, setExtraLines] = useState<Partial<Record<UsageStatementCategory, ExtraLines>>>({})

  useEffect(() => {
    const controller = new AbortController()
    void fetch(endpoint, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response))
        return (await response.json()) as UsageStatement
      })
      .then((statement) => {
        if (!controller.signal.aborted) setState({ status: 'ready', statement })
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load usage.' })
        }
      })
    return () => controller.abort()
  }, [endpoint])

  const toggleCategory = useCallback((category: UsageStatementCategory) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  const showMore = useCallback((category: UsageStatementCategory, offset: number) => {
    setExtraLines((current) => ({
      ...current,
      [category]: { hasMore: current[category]?.hasMore ?? true, lines: current[category]?.lines ?? [], loading: true },
    }))
    void loadLines(endpoint, category, offset)
      .then((page) => {
        setExtraLines((current) => ({
          ...current,
          [category]: {
            hasMore: page.hasMore,
            lines: [...(current[category]?.lines ?? []), ...page.lines],
            loading: false,
          },
        }))
      })
      .catch(() => {
        setExtraLines((current) => {
          const existing = current[category]
          return existing ? { ...current, [category]: { ...existing, loading: false } } : current
        })
      })
  }, [endpoint])

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
        <Loader2 size={14} className="mr-2 animate-spin" />Loading usage…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
        {state.message}
      </div>
    )
  }

  const { statement } = state
  return (
    <div data-testid="usage-statement" className="overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="flex items-baseline justify-between gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <ReceiptText size={14} className="text-[var(--muted)]" />
            Usage this period
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Since {formatDate(statement.periodStart)}
          </p>
        </div>
        <span className="text-sm font-medium text-[var(--foreground)]">{formatCost(statement.totalCents)}</span>
      </div>

      {statement.categories.length === 0 ? (
        <p className="border-t border-[var(--border)] px-4 py-5 text-xs text-[var(--muted)]">
          No billed usage yet this period. Model calls, browser runs, sandboxes, and tools will show up here.
        </p>
      ) : (
        <div className="border-t border-[var(--border)]">
          {statement.categories.map((category) => {
            const isExpanded = expanded.has(category.category)
            const extra = extraLines[category.category]
            const lines = [...category.lines, ...(extra?.lines ?? [])]
            const hasMore = extra?.hasMore ?? category.hasMore
            return (
              <div key={category.category} className="border-b border-[var(--border)] last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-subtle)]"
                  onClick={() => toggleCategory(category.category)}
                  aria-expanded={isExpanded}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--foreground)]">
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-[var(--muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate">{USAGE_STATEMENT_CATEGORY_LABELS[category.category]}</span>
                    <span className="shrink-0 text-xs text-[var(--muted-light)]">
                      {category.count} {category.count === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-[var(--foreground)]">{formatCost(category.totalCents)}</span>
                </button>
                {isExpanded ? (
                  <ul className="bg-[var(--surface-subtle)] px-4 py-1">
                    {lines.map((line) => (
                      <li key={line.id} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-[var(--muted-light)]">{formatTime(line.occurredAt)}</span>
                          <span className="truncate text-[var(--foreground)]">{line.label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--muted)]">{formatCost(line.costCents)}</span>
                      </li>
                    ))}
                    {hasMore ? (
                      <li className="py-1.5">
                        <button
                          type="button"
                          disabled={extra?.loading}
                          onClick={() => showMore(category.category, lines.length)}
                          className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] disabled:opacity-50"
                        >
                          {extra?.loading ? <Loader2 size={12} className="animate-spin" /> : null}
                          Show more
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

async function loadLines(
  endpoint: string,
  category: UsageStatementCategory,
  offset: number,
): Promise<UsageStatementLinesPage> {
  const params = new URLSearchParams({
    category,
    limit: String(USAGE_STATEMENT_DEFAULT_LINES),
    offset: String(offset),
  })
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response))
  return (await response.json()) as UsageStatementLinesPage
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`
}

function formatCost(cents: number): string {
  const dollars = cents / 100
  if (dollars > 0 && dollars < 0.01) return `$${dollars.toFixed(4)}`
  return `$${dollars.toFixed(2)}`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}
