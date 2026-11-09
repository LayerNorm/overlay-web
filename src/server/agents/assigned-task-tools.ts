import 'server-only'

import type { ToolSet } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'

/**
 * The tools an agent needs to work a task it was assigned: read it, keep its
 * status current, and comment on it. The assignment message tells the agent to
 * use exactly these, so an agent whose own grant lacks the Tasks group still
 * gets them in the task's thread — limited to that one task.
 */
export const ASSIGNED_TASK_TOOL_IDS = ['get_task', 'update_task', 'comment_on_task'] as const

/** What `update_task` may change on an assigned task when the agent holds no Tasks grant of its own. */
const ASSIGNED_UPDATE_FIELDS = new Set(['taskId', 'revision', 'status', 'blocked'])

/** The active task whose assignment started this agent in this conversation, readable by the actor. */
export async function findAssignedTaskId(args: {
  actorUserId: string
  agentPrincipalId: string
  conversationId: string
  workspaceId: string
}): Promise<string | null> {
  try {
    return await getOverlayServerContext().appData.repositories.work.assignedTaskIdForConversation({
      userId: args.actorUserId,
      workspaceId: args.workspaceId,
      agentPrincipalId: args.agentPrincipalId,
      conversationId: args.conversationId,
    })
  } catch (_error) {
    logger.warn('[workspace-agent] assigned task lookup failed', { conversationId: args.conversationId })
    return null
  }
}

/** Assignment tools the agent's own grant does not already hold. */
export function assignedTaskToolIdsToAdd(grantedOverlayToolIds: readonly string[]): string[] {
  const granted = new Set(grantedOverlayToolIds)
  return ASSIGNED_TASK_TOOL_IDS.filter((id) => !granted.has(id))
}

function assignedTaskError(taskId: string): { success: false; error: string } {
  return { success: false, error: `This agent can only use this tool on its assigned task (${taskId}).` }
}

/**
 * Narrows the tools granted only through the assignment to the assigned task.
 * Tools the agent's own grant already held are left as they are.
 */
export function scopeAssignedTaskTools(tools: ToolSet, args: { taskId: string; addedToolIds: readonly string[] }): ToolSet {
  if (args.addedToolIds.length === 0) return tools
  const scoped: ToolSet = { ...tools }
  for (const toolId of args.addedToolIds) {
    const definition = tools[toolId]
    const execute = definition?.execute
    if (!definition || !execute) continue
    scoped[toolId] = {
      ...definition,
      execute: async (input: unknown, options: unknown) => {
        const fields = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
        if (typeof fields.taskId !== 'string' || fields.taskId.trim() !== args.taskId) return assignedTaskError(args.taskId)
        if (toolId === 'update_task') {
          const extra = Object.keys(fields).filter((key) => fields[key] !== undefined && !ASSIGNED_UPDATE_FIELDS.has(key))
          if (extra.length > 0) {
            return { success: false, error: `On its assigned task this agent can change only status and blocked, not ${extra.join(', ')}.` }
          }
        }
        return (execute as (input: unknown, options: unknown) => unknown)(input, options)
      },
    } as ToolSet[string]
  }
  return scoped
}
