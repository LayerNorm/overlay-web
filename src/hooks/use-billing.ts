'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { api } from '../../convex/_generated/api'

function useReady() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  return isAuthenticated && !isLoading
}

/**
 * Workspace → Billing, live: a confirmed payment, top-up, charge or plan change shows without reloading. Undefined
 * while loading, null without access to the workspace.
 */
export function useLiveWorkspaceBilling(workspaceId: string | null | undefined) {
  const ready = useReady()
  return useQuery(api.billing.browse.workspaceSummary, ready && workspaceId ? { workspaceId } : 'skip') as
    WorkspaceBillingSummaryResponse | null | undefined
}

/**
 * The workspace's balance and plan as the composer, pickers and meters read it, live. Undefined while loading; null
 * without access or when billing is off on this deployment.
 */
export function useLiveWorkspaceEntitlements<T>(workspaceId: string | null | undefined, enabled = true): T | null | undefined {
  const ready = useReady()
  return useQuery(api.billing.browse.entitlements, ready && enabled && workspaceId ? { workspaceId } : 'skip') as T | null | undefined
}
