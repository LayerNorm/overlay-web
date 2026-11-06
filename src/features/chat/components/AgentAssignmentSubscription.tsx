'use client'

import { useMemo } from 'react'
import { useConvexAuth, useQueries, type RequestForQueries } from '@/components/providers/convex-hooks'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
import { api } from '../../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { AgentAssignments } from './AgentAssignments'

type AssignmentView = FunctionReturnType<typeof api.collaboration.agentAssignments.forConversation>
type Props = { workspaceId: string | null; conversationId: string }

function AssignmentSubscription({ workspaceId, conversationId }: Props) {
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
  if (!result || result instanceof Error) return null
  const href = (item: { agentId: string; conversationId: string; scope: 'workspace' | 'personal' }) =>
    workspaceHref(workspaceId, agentThreadHref('/agents', item.agentId, item.conversationId, item.scope), item.scope)
  return <AgentAssignments
    parent={result.parent ? { ...result.parent, href: href(result.parent) } : null}
    assignments={result.assignments.map(item => ({ ...item, href: href(item) }))}
  />
}

export function AgentAssignmentSubscription(props: Props) {
  const { hasConvexClient } = useConvexAuthConfiguration()
  if (!hasConvexClient || !props.workspaceId) return null
  return <AssignmentSubscription key={`${props.workspaceId}:${props.conversationId}`} {...props} />
}
