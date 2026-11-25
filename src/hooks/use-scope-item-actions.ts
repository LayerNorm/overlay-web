'use client'

import type { ScopedResourceKind } from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import {
  scopeItemOptions,
  type ResourceKind,
  type ScopeItemOptions,
  type ScopedRow,
} from '@/shared/workspaces/resource-scope'

/** What an item row needs to know to offer Move, Archive, and Restore. */
export type ScopedItem = Omit<ScopedRow, 'userId'> & { _id: string; userId?: string }

/**
 * Move to Workspace, archive, and restore for one kind of resource, with the same rules the server enforces (so the
 * buttons only appear for what will work): moves are one-way, Personal → Workspace; only the creator moves an item, and
 * only if the workspace lets members move or they are an owner/admin; creators and, for workspace items, owners and
 * admins archive and restore. Connectors never move: the workspace connects an account of its own.
 */
export function useScopeItemActions(kind: ResourceKind, resource: ScopedResourceKind) {
  const { user } = useAuth()
  const { access, viewer } = useWorkspaceCreateAccess()
  const solo = useIsSoloWorkspace()
  const viewerWithUser = viewer && user?.id ? { userId: user.id, role: viewer.role } : null

  const optionsFor = (item: ScopedItem): ScopeItemOptions => {
    if (!viewerWithUser || !item.userId) return { moveTo: null, canArchive: false, canRestore: false }
    const options = scopeItemOptions(kind, { ...item, userId: item.userId }, viewerWithUser, access.scope)
    // Nobody to share with: a move into Workspace means nothing here, and would be exposed to whoever is invited next.
    // A connector is a signed-in account, which never moves. Archive and restore stay.
    return solo || resource === 'connectors' ? { ...options, moveTo: null } : options
  }

  return {
    optionsFor,
    /** Moves are one-way, to Workspace; `withAgent` takes an automation's creator-only agent along. */
    move: (id: string, options?: { withAgent?: boolean }) => overlayAppClient.scope.move(resource, id, 'workspace', options),
    archive: (id: string) => overlayAppClient.scope.archive(resource, id),
    restore: (id: string) => overlayAppClient.scope.restore(resource, id),
  }
}
