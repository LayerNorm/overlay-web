'use client'

import { createContext, type ReactNode } from 'react'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import type {
  WorkspaceClient,
  WorkspaceCreateInput,
  WorkspaceLifecycleStatus,
  WorkspaceSummary,
} from '@/shared/workspaces/types'

export type WorkspaceContextValue = {
  status: WorkspaceLifecycleStatus
  workspaces: readonly WorkspaceSummary[]
  invitations?: readonly AccountWorkspaceInvitation[]
  activeWorkspace: WorkspaceSummary | null
  activeWorkspaceId: string | null
  error: string | null
  switchingWorkspaceId: string | null
  resolvedRouteTargetKey: string | null
  refresh(): Promise<void>
  createWorkspace(input: WorkspaceCreateInput, options?: { idempotencyKey: string }): Promise<WorkspaceSummary>
  switchWorkspace(workspaceId: string): Promise<WorkspaceSummary>
}

export type WorkspaceProviderProps = {
  children: ReactNode
  enabled?: boolean
  client: WorkspaceClient
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export const EMPTY_WORKSPACES: WorkspaceSummary[] = []
