'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { workspaceSearchHref, type WorkspaceSearchResult } from '@/shared/search/workspace-search'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { SharedWithMeList, type SharedWithMeState } from '@/components/share/SharedWithMeList'

/**
 * Workspace surface listing what other people shared with the current person.
 * For a guest this is effectively their entire workspace.
 */
export function SharedWithMeView() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  const [state, setState] = useState<SharedWithMeState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (workspaceId: string) => {
    const { results } = await overlayAppClient.sharing.sharedWithMe(workspaceId)
    return results
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    // Queued so the loading transition does not cascade renders synchronously.
    queueMicrotask(() => { if (!cancelled) setState({ status: 'loading' }) })
    void load(activeWorkspaceId)
      .then((results: WorkspaceSearchResult[]) => {
        if (!cancelled) setState({ status: 'ready', results })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Try again in a moment.',
        })
      })
    return () => { cancelled = true }
  }, [activeWorkspaceId, load, reloadKey])

  return (
    <div className="min-h-full bg-[var(--background)] px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">Shared with me</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {activeWorkspace?.kind === 'personal'
            ? 'Resources other people shared with you appear here once you switch to their workspace.'
            : `Everything in ${activeWorkspace?.name ?? 'this workspace'} that reaches you through a person, team, or room grant.`}
        </p>
        <div className="mt-6">
          <SharedWithMeList
            state={state}
            hrefFor={(result) => workspaceSearchHref(result, activeWorkspaceId)}
            onRetry={() => setReloadKey((current) => current + 1)}
          />
        </div>
      </div>
    </div>
  )
}
