/**
 * Automation Agent Turn — durable in-workflow execution of an automation's
 * agent loop via `WorkflowAgent`.
 *
 * This replaces the previous shape where the durable workflows shelled out to
 * `POST /api/v1/conversations/act` (a request-scoped `ToolLoopAgent` that died
 * with its HTTP request). Here the model/tool loop itself runs as workflow
 * steps, so a process restart resumes at the failing step instead of losing
 * the whole turn.
 *
 * Invoked (not started) by the durable workflows — the caller's `'use
 * workflow'` scope is what makes `runAutomationAgentTurn`'s steps durable.
 * All step inputs/outputs must stay JSON-serializable.
 */

import { WorkflowAgent } from '@ai-sdk/workflow'
import {
  isStepCount,
  jsonSchema,
  tool,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from 'ai'
import { FatalError, getWorkflowMetadata } from 'workflow'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import { MAX_TOOL_STEPS_ACT } from '@/server/tools/tools/policy'
import { MAX_ACT_OUTPUT_TOKENS_PER_STEP } from '@/server/app-api/v1/conversations/act/route-helpers'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { automationService } from '@/server/automations/http'
import {
  AutomationTurnError,
  ensureAutomationConversation,
  failAutomationAgentTurn,
  finalizeAutomationAgentTurn,
  prepareAutomationAgentTurn,
  type AutomationAgentTurnInput,
  type AutomationAgentTurnPlan,
} from '@/server/automations/automation-turn-runner'

export type { AutomationAgentTurnInput, AutomationAgentTurnPlan }

// Approval-gated tools cannot reach a human during an unattended automation
// run — there is no approval surface attached to an automation run record —
// so pending approvals are denied with an explicit reason and the loop
// continues. This mirrors the previous behavior (those calls never executed
// while the drained act stream ignored their approval requests), but gives
// the model a definitive denial instead of a silent no-op.
const AUTOMATION_TOOL_APPROVAL_DENIAL =
  'Tool approvals are not available in unattended automation runs.'

const AUTOMATION_MAX_APPROVAL_CYCLES = 8

const toolContextSchema = jsonSchema<PersonalChatWorkToolingContext & {
  automationRunId?: string
  toolName: string
}>({
  type: 'object',
  additionalProperties: true,
  required: ['toolName'],
  properties: {
    automationRunId: { type: 'string' },
    toolName: { type: 'string' },
  },
})

function buildAutomationWorkflowTools(
  definitions: PersonalChatWorkToolDefinition[],
): ToolSet {
  return Object.fromEntries(definitions.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      contextSchema: toolContextSchema,
      execute: executePersonalChatWorkTool,
      ...(definition.needsApproval
        ? { needsApproval: personalChatWorkToolNeedsApproval }
        : {}),
    }),
  ]))
}

// ---------------------------------------------------------------------------
// Steps — thin wrappers over the server-side turn runner. Each is durable and
// independently retryable; the heavy lifting lives in automation-turn-runner.
// ---------------------------------------------------------------------------

async function ensureConversationStep(input: AutomationAgentTurnInput): Promise<{
  conversationId: string
  workspaceId: string
}> {
  'use step'
  return await ensureAutomationConversation(input)
}

async function markRunStartedStep(input: {
  runId: string
  userId: string
  conversationId: string
  turnId: string
}): Promise<void> {
  'use step'
  await automationService.markRunStarted({
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    turnId: input.turnId,
  })
}

async function prepareTurnStep(
  input: AutomationAgentTurnInput & { conversationId: string; workspaceId: string },
): Promise<AutomationAgentTurnPlan> {
  'use step'
  try {
    return await prepareAutomationAgentTurn(input)
  } catch (error) {
    // Terminal denials (unsupported model, policy denial, budget refusal) can
    // never succeed on retry — mark them fatal so the step doesn't burn its
    // retry budget and the run fails immediately.
    if (error instanceof AutomationTurnError && error.statusCode < 500) {
      throw new FatalError(error.message)
    }
    throw error
  }
}

async function finalizeTurnStep(args: {
  input: AutomationAgentTurnInput & { conversationId: string }
  plan: AutomationAgentTurnPlan
  steps: StepResult<ToolSet>[]
  text: string
  workflowRunId?: string
}): Promise<void> {
  'use step'
  await finalizeAutomationAgentTurn(args)
}

async function failTurnStep(args: {
  input: AutomationAgentTurnInput & { conversationId?: string }
  plan?: AutomationAgentTurnPlan
  steps?: StepResult<ToolSet>[]
  error: string
  workflowRunId?: string
}): Promise<void> {
  'use step'
  await failAutomationAgentTurn(args)
}

/**
 * Safety-net status check for the scheduling loop — reads the automation row
 * directly instead of the old self-HTTP call.
 */
export async function checkAutomationEnabled(input: {
  automationId: string
  userId: string
}): Promise<{ enabled: boolean; deleted: boolean }> {
  'use step'
  try {
    const automation = await automationService.getAutomationForExecution({
      automationId: input.automationId,
      userId: input.userId,
    })
    if (!automation) return { enabled: false, deleted: true }
    return { enabled: automation.enabled !== false, deleted: false }
  } catch (_error) {
    // Fail open — a transient read failure should not cancel the schedule.
    return { enabled: true, deleted: false }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — called from 'use workflow' functions; runs in workflow scope.
// ---------------------------------------------------------------------------

export async function runAutomationAgentTurn(
  input: AutomationAgentTurnInput,
): Promise<{ conversationId: string }> {
  const { workflowRunId } = getWorkflowMetadata()

  const ensured = await ensureConversationStep(input)
  const turnInput = { ...input, conversationId: ensured.conversationId, workspaceId: ensured.workspaceId }

  // Mark the run row started before the heavy prepare so a failure below lands
  // on a 'running' record instead of leaving it queued forever.
  if (input.runId) {
    await markRunStartedStep({
      runId: input.runId,
      userId: input.userId,
      conversationId: ensured.conversationId,
      turnId: input.turnId,
    })
  }

  let plan: AutomationAgentTurnPlan | undefined
  const allSteps: StepResult<ToolSet>[] = []
  try {
    plan = await prepareTurnStep(turnInput)
    const resolvedPlan = plan

    const tools = buildAutomationWorkflowTools(resolvedPlan.toolDefinitions)
    const automationRunId = input.runId ?? input.turnId
    const toolsContext = Object.fromEntries(resolvedPlan.toolDefinitions.map((definition) => [
      definition.name,
      {
        ...resolvedPlan.toolingContext,
        automationRunId,
        toolName: definition.name,
      },
    ]))
    const agent = new WorkflowAgent({
      id: `automation-run:${automationRunId}`,
      model: resolvedPlan.gatewayModelId,
      tools,
      toolsContext,
      instructions: resolvedPlan.instructions,
      allowSystemInMessages: true,
      maxOutputTokens: MAX_ACT_OUTPUT_TOKENS_PER_STEP,
      maxRetries: 0,
      stopWhen: isStepCount(MAX_TOOL_STEPS_ACT),
      ...(modelSupportsZeroDataRetention(resolvedPlan.effectiveModelId)
        ? { providerOptions: { gateway: { zeroDataRetention: true } } }
        : {}),
    } as never)

    let messages: ModelMessage[] = resolvedPlan.messages
    for (let approvalCycle = 0; approvalCycle < AUTOMATION_MAX_APPROVAL_CYCLES; approvalCycle += 1) {
      const result = await agent.stream({ messages } as never)
      allSteps.push(...result.steps)

      const completedToolCallIds = new Set(result.toolResults.map((part) => part.toolCallId))
      const pendingApprovals = result.toolCalls.filter((call) => {
        if (completedToolCallIds.has(call.toolCallId)) return false
        return resolvedPlan.toolDefinitions.some((definition) =>
          definition.name === call.toolName && definition.needsApproval)
      })

      if (pendingApprovals.length === 0) {
        const finalText = allSteps.at(-1)?.text ?? ''
        await finalizeTurnStep({
          input: turnInput,
          plan: resolvedPlan,
          steps: allSteps,
          text: finalText,
          workflowRunId,
        })
        return { conversationId: resolvedPlan.conversationId }
      }

      messages = [
        ...result.messages,
        {
          role: 'tool',
          content: pendingApprovals.map((call) => ({
            type: 'tool-approval-response' as const,
            approvalId: `approval-${call.toolCallId}`,
            approved: false,
            reason: AUTOMATION_TOOL_APPROVAL_DENIAL,
          })),
        },
      ]
    }
    throw new FatalError('Automation run exceeded the maximum number of approval cycles.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown workflow failure'
    await failTurnStep({
      input: turnInput,
      plan,
      steps: allSteps,
      error: message,
      workflowRunId,
    })
    throw error
  }
}
