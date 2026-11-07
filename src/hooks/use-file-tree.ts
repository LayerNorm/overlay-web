'use client'

import { useCallback } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { KnowledgeFile } from '@overlay/app-core'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The live file tree (files, folders, notes, outputs) for the active workspace and view: undefined while loading,
 * null when the viewer cannot read it. Every caller with the same view shares one Convex subscription, so a change
 * anywhere reaches the Files page, the sidebar and other tabs without events or refetches.
 */
export function useFileTree(view: PanelScope, enabled = true): KnowledgeFile[] | null | undefined {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = status === 'ready' ? activeWorkspaceId : null
  const rows = useQuery(
    api.files.browse.list,
    enabled && workspaceId && isAuthenticated && !isLoading ? { workspaceId, view } : 'skip',
  )
  return rows as KnowledgeFile[] | null | undefined
}

/** A thread's files, live: undefined while loading, null when the viewer cannot read the workspace. */
export function useConversationFiles(conversationId: string): KnowledgeFile[] | null | undefined {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = status === 'ready' ? activeWorkspaceId : null
  const rows = useQuery(
    api.files.browse.forConversation,
    workspaceId && isAuthenticated && !isLoading ? { workspaceId, conversationId } : 'skip',
  )
  return rows as KnowledgeFile[] | null | undefined
}

/** Patches one file in every cached tree of its workspace; the server answer replaces the patch. */
function patchTrees(store: OptimisticLocalStore, workspaceId: string, fileId: string, patch: { name?: string; parentId?: string | null }) {
  for (const { args, value } of store.getAllQueries(api.files.browse.list)) {
    if (!value || args.workspaceId !== workspaceId) continue
    store.setQuery(api.files.browse.list, args, value.map((file) => (
      file._id === fileId ? { ...file, ...patch, updatedAt: Date.now() } : file
    )))
  }
}

/** Rename and move, applied to every open tree at once. */
export function useFileTreeCommands() {
  const { activeWorkspaceId } = useWorkspace()
  const renameFile = useMutation(api.files.browse.rename).withOptimisticUpdate((store, args) => {
    patchTrees(store, args.workspaceId, args.fileId, { name: args.name.trim() })
  })
  const moveFile = useMutation(api.files.browse.move).withOptimisticUpdate((store, args) => {
    patchTrees(store, args.workspaceId, args.fileId, { parentId: args.parentId })
  })
  const rename = useCallback(async (fileId: string, name: string) => {
    if (!activeWorkspaceId) throw new Error('No workspace')
    await renameFile({ workspaceId: activeWorkspaceId, fileId: fileId as Id<'files'>, name })
  }, [activeWorkspaceId, renameFile])
  const move = useCallback(async (fileId: string, parentId: string | null) => {
    if (!activeWorkspaceId) throw new Error('No workspace')
    await moveFile({ workspaceId: activeWorkspaceId, fileId: fileId as Id<'files'>, parentId: parentId as Id<'files'> | null })
  }, [activeWorkspaceId, moveFile])
  return { rename, move }
}
