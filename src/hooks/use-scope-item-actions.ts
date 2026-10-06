'use client'

import type { ScopedResourceKind } from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import {
  scopeItemOptions,
  type ResourceKind,
  type ResourceScope,
  type ScopeItemOptions,
  type ScopedRow,
} from '@/shared/workspaces/resource-scope'

/** What an item row needs to know to offer Move, Archive, and Restore. */
export type ScopedItem = Omit<ScopedRow, 'userId'> & { _id: string; userId?: string }

/**
 * Move, archive, and restore for one kind of resource, with the same rules the server enforces (so the buttons only
 * appear for what will work): only the creator moves an item, and only if the workspace lets members move or they are an
 * owner/admin; creators and, for workspace items, owners and admins archive and restore.
 */
export function useScopeItemActions(kind: ResourceKind, resource: ScopedResourceKind) {
  const { user } = useAuth()
  const { access, viewer } = useWorkspaceCreateAccess()
  const viewerWithUser = viewer && user?.id ? { userId: user.id, role: viewer.role } : null

  const optionsFor = (item: ScopedItem): ScopeItemOptions => {
    if (!viewerWithUser || !item.userId) return { moveTo: null, canArchive: false, canRestore: false }
    return scopeItemOptions(kind, { ...item, userId: item.userId }, viewerWithUser, access.scope)
  }

  return {
    optionsFor,
    move: (id: string, to: ResourceScope) => overlayAppClient.scope.move(resource, id, to),
    archive: (id: string) => overlayAppClient.scope.archive(resource, id),
    restore: (id: string) => overlayAppClient.scope.restore(resource, id),
  }
}
