'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useConvexAuth, useQueries, type RequestForQueries } from '@/components/providers/convex-hooks'
import { useHasConvexClient } from '@/components/providers/ConvexAuthProvider'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { assignmentThreadHref } from '@/components/layout/sidebar-nav'
import { api } from '../../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { AssignmentTrace } from './AssignmentTrace'
import { AgentAssignments, assignmentsByResponse, type AssignmentNavigation, type AssignmentNavigationItem } from './AgentAssignments'

type AssignmentView = FunctionReturnType<typeof api.collaboration.agentAssignments.forConversation>
type Props = { workspaceId: string | null; conversationId: string }

export type ConversationAssignments = {
  parent: AssignmentNavigation | null
  assignments: AssignmentNavigationItem[]
  byMessage: Map<string, AssignmentNavigationItem[]>
  unanchored: AssignmentNavigationItem[]
}

/** The conversation's assignments with links, or null until they load. Call only with a Convex client. */
function useLoadedAssignments({ workspaceId, conversationId }: Props): ConversationAssignments | null {
  const { isAuthenticated } = useConvexAuth()
  const workspaceHref = useWorkspaceHref()
  const queries = useMemo(() => {
    const requests: RequestForQueries = {}
    if (workspaceId && isAuthenticated) {
      requests.assignments = {
        query: api.collaboration.agentAssignments.forConversation,
        args: { workspaceId, conversationId },
      }
    }
    return requests
  }, [workspaceId, conversationId, isAuthenticated])
  const result = useQueries(queries).assignments as AssignmentView | Error | undefined
  return useMemo(() => {
    if (!result || result instanceof Error) return null
    const href = (item: Parameters<typeof assignmentThreadHref>[0]) =>
      workspaceHref(workspaceId, assignmentThreadHref(item), item.scope)
    const assignments = result.assignments.map(item => ({ ...item, href: href(item) }))
    return {
      parent: result.parent ? { ...result.parent, href: href(result.parent) } : null,
      assignments,
      ...assignmentsByResponse(assignments),
    }
  }, [result, workspaceHref, workspaceId])
}

const AssignmentsContext = createContext<ConversationAssignments | null>(null)

function LoadedAssignmentsProvider({ children, ...props }: Props & { children: ReactNode }) {
  return <AssignmentsContext.Provider value={useLoadedAssignments(props)}>{children}</AssignmentsContext.Provider>
}

/** Loads a conversation's assignments once, for its responses, its footer and its side panel. */
export function AgentAssignmentsProvider({ children, ...props }: Props & { children: ReactNode }) {
  const hasConvexClient = useHasConvexClient()
  if (!hasConvexClient || !props.workspaceId) return <>{children}</>
  return <LoadedAssignmentsProvider key={`${props.workspaceId}:${props.conversationId}`} {...props}>{children}</LoadedAssignmentsProvider>
}

export function useConversationAssignments(): ConversationAssignments | null {
  return useContext(AssignmentsContext)
}

/** The assignments one response made, as a dropdown row under that response's text. */
export function ResponseAssignments({ messageId }: { messageId: string }) {
  const items = useContext(AssignmentsContext)?.byMessage.get(messageId)
  if (!items) return null
  return <AssignmentTrace items={items} />
}

/**
 * Below the transcript: where an assignment thread came from, and any assignment whose response can no longer be
 * traced. Assignments made by a known response render inside it instead.
 */
export function AgentAssignmentSubscription() {
  const loaded = useContext(AssignmentsContext)
  if (!loaded) return null
  return <AgentAssignments parent={loaded.parent} assignments={loaded.unanchored} />
}
