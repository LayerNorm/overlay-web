/**
 * Automation Run Workflow — durable execution of automation turns via the
 * Vercel Workflow SDK.
 *
 * The agent turn runs in-workflow as a durable agent loop (see
 * ./automation-agent-turn): conversation creation, context assembly, model
 * calls, tool calls, message persistence, usage accounting, and run-record
 * settlement are all durable steps. If the process dies during any step, the
 * workflow resumes from the last completed step instead of losing the whole
 * turn — which is what the old self-HTTP call into the act route did.
 *
 * Trigger via: POST /api/v1/automations/{id}/run
 * Inspect via: npx workflow web
 *
 * Input must be fully serializable (strings, numbers, booleans) — no class
 * instances, functions, or server-only modules.
 */

import { runAutomationAgentTurn } from './automation-agent-turn'

export {
  buildAutomationUserMessage,
  buildAutomationSystemPrompt,
} from '@/shared/automations/automation-prompts'

export type AutomationRunWorkflowInput = {
  runId: string
  userId: string
  automationId: string
  name: string
  description: string
  instructions: string
  projectId?: string
  modelId?: string
  conversationId?: string
  turnId: string
  scheduledFor: number
  baseUrl: string
  workspaceId?: string
}

export async function automationRunWorkflow(input: AutomationRunWorkflowInput) {
  "use workflow"

  const result = await runAutomationAgentTurn({
    automationId: input.automationId,
    runId: input.runId,
    userId: input.userId,
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    projectId: input.projectId,
    modelId: input.modelId,
    conversationId: input.conversationId,
    turnId: input.turnId,
    scheduledFor: input.scheduledFor,
    workspaceId: input.workspaceId,
  })

  return { conversationId: result.conversationId, runId: input.runId }
}
