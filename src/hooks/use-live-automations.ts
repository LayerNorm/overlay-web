'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import type { AutomationDetail, AutomationRunSummary as AutomationRun, AutomationSummary } from '@overlay/app-core'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

function useAutomationWorkspace(): string | null {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  return status === 'ready' && activeWorkspaceId && isAuthenticated && !isLoading ? activeWorkspaceId : null
}

/**
 * The automations of a view, live (agent-owned ones included, shown under their agent's avatar). Every caller shares
 * one subscription, so a schedule, name or enabled change anywhere reaches every list. Undefined while loading.
 */
export function useLiveAutomations(view: PanelScope | undefined): AutomationSummary[] | null | undefined {
  const workspaceId = useAutomationWorkspace()
  return useQuery(api.automations.browse.list, workspaceId
    ? { workspaceId, includeAgentBound: true, ...(view ? { view } : {}) }
    : 'skip') as AutomationSummary[] | null | undefined
}

/** One automation, live; null once deleted or unreadable. */
export function useLiveAutomation(automationId: string | null): AutomationDetail | null | undefined {
  const workspaceId = useAutomationWorkspace()
  return useQuery(api.automations.browse.get, workspaceId && automationId
    ? { workspaceId, automationId: automationId as Id<'automations'> }
    : 'skip') as AutomationDetail | null | undefined
}

/** An automation's runs, newest first, live through every state change. Undefined while loading. */
export function useLiveAutomationRuns(automationId: string | null): AutomationRun[] | undefined {
  const workspaceId = useAutomationWorkspace()
  return useQuery(api.automations.browse.runs, workspaceId && automationId
    ? { workspaceId, automationId: automationId as Id<'automations'> }
    : 'skip') as AutomationRun[] | undefined
}
