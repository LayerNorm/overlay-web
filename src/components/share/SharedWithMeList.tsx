'use client'

import React from 'react'
import { Bot, FileText, FolderOpen, Library, MessageSquare, Users, Workflow } from 'lucide-react'
import {
  WORKSPACE_SEARCH_KIND_LABELS,
  type WorkspaceSearchKind,
  type WorkspaceSearchResult,
} from '@/shared/search/workspace-search'

export type SharedWithMeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; results: WorkspaceSearchResult[] }

/**
 * Everything shared with the current person in this workspace, grouped by kind.
 * Guests see this as their whole workspace, so it must never imply there is more
 * they cannot see.
 */
export function SharedWithMeList({
  state,
  hrefFor,
  onRetry,
}: {
  state: SharedWithMeState
  hrefFor(result: WorkspaceSearchResult): string
  onRetry?(): void
}) {
  if (state.status === 'loading') {
    return (
      <div className="space-y-3" aria-label="Loading shared resources" data-testid="shared-with-me-loading">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-14 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div
        role="alert"
        data-testid="shared-with-me-error"
        className="rounded-xl border border-[var(--border)] px-4 py-5 text-sm text-[var(--muted)]"
      >
        <p className="text-[var(--foreground)]">Could not load shared resources</p>
        <p className="mt-1 text-xs">{state.message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
          >
            Try again
          </button>
        ) : null}
      </div>
    )
  }

  if (state.results.length === 0) {
    return (
      <div
        data-testid="shared-with-me-empty"
        className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]"
      >
        <p className="text-[var(--foreground)]">Nothing shared with you yet</p>
        <p className="mt-1 text-xs">
          Files, projects, knowledge bases, automations, and agents appear here when
          someone shares them with you, a team you are on, or a room you are in.
        </p>
      </div>
    )
  }

  const groups = groupByKind(state.results)
  return (
    <div className="space-y-6" data-testid="shared-with-me-list">
      {groups.map(([kind, results]) => (
        <section key={kind} aria-labelledby={`shared-${kind}`}>
          <h3
            id={`shared-${kind}`}
            className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]"
          >
            {WORKSPACE_SEARCH_KIND_LABELS[kind]}
          </h3>
          <ul className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]">
            {results.map((result) => (
              <li key={`${result.kind}:${result.id}`} className="border-b border-[var(--border)] last:border-b-0">
                <a
                  href={hrefFor(result)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-subtle)]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-subtle)] text-[var(--muted)]">
                    <KindIcon kind={result.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                      {result.title}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {describeAccess(result)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function describeAccess(result: WorkspaceSearchResult): string {
  const role = result.accessRole === 'editor' ? 'Can edit'
    : result.accessRole === 'operator' ? 'Can run'
      : 'Can view'
  if (result.sharedVia === 'team') return `${role} · through a team`
  if (result.sharedVia === 'room') return `${role} · through a room`
  return `${role} · shared with you`
}

function groupByKind(
  results: readonly WorkspaceSearchResult[],
): Array<[WorkspaceSearchKind, WorkspaceSearchResult[]]> {
  const groups = new Map<WorkspaceSearchKind, WorkspaceSearchResult[]>()
  for (const result of results) {
    groups.set(result.kind, [...(groups.get(result.kind) ?? []), result])
  }
  return [...groups]
}

function KindIcon({ kind }: { kind: WorkspaceSearchKind }) {
  if (kind === 'project') return <FolderOpen size={14} />
  if (kind === 'knowledge_base') return <Library size={14} />
  if (kind === 'automation') return <Workflow size={14} />
  if (kind === 'agent') return <Bot size={14} />
  if (kind === 'conversation') return <MessageSquare size={14} />
  if (kind === 'file') return <FileText size={14} />
  return <Users size={14} />
}
