/**
 * Automation Agent Turn — durable in-workflow execution of an automation's
 * agent loop.
 *
 * The loop is intentionally manual rather than `WorkflowAgent`: the SDK's
 * internal model step resolves `gateway.languageModel(<id>)`, which locks
 * durable runs to AI Gateway models. Our own `'use step'` rebuilds the model
 * via `getLanguageModel` inside the step — the same resolution the act route
 * uses — so BYOK, OpenRouter, and NVIDIA NIM models all work, and user
 * credentials are fetched at call time instead of sitting in the workflow
 * event log.
 *
 * Each iteration is a durable `generateText` step (model emits tool calls
 * only — tools are rebuilt without `execute`), followed by one durable step
 * per tool call. A process restart resumes at the failing step instead of
 * losing the whole turn — which is what the old self-HTTP call into the act
 * route did.
 *
 * Invoked (not started) by the durable workflows — the caller's `'use
 * workflow'` scope is what makes these steps durable. All step inputs/outputs
 * must stay JSON-serializable.
 */

import type { ModelMessage, StepResult, ToolSet } from 'ai'
import { FatalError, getWorkflowMetadata } from 'workflow'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import { MAX_TOOL_STEPS_ACT } from '@/server/tools/tools/policy'
import { MAX_ACT_OUTPUT_TOKENS_PER_STEP } from '@/server/app-api/v1/conversations/act/route-helpers'
import { automationService } from '@/server/automations/http'
import {
  AutomationTurnError,
  callDurableAutomationModel,
  ensureAutomationConversation,
  failAutomationAgentTurn,
  finalizeAutomationAgentTurn,
  prepareAutomationAgentTurn,
  type AutomationAgentTurnInput,
  type AutomationAgentTurnPlan,
  type AutomationModelCallResult,
} from '@/server/automations/automation-turn-runner'
import { getOverlayServerContext } from '@/server/bootstrap'
import { isHarnessBackendReady } from '@/server/harness/backend-readiness'
import { assertAutomationAdmissionSource } from '@/server/harness/automation-access'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { personalHarnessPolicy } from '@/server/harness/personal-admission-policy'
import { harnessToolsRequirePlan } from '@/server/harness/write-tools'
import { personalHarnessWorkflow } from './personal-harness'
import { agentRunService } from '@/server/conversations/http'

export type { AutomationAgentTurnInput, AutomationAgentTurnPlan }

// Approval-gated tools cannot reach a human during an unattended automation
// run — there is no approval surface attached to an automation run record —
// so pending approvals are denied with an explicit reason and the loop
// continues. The model sees a definitive `execution-denied` result instead of
// a silent no-op (the previous behavior was to drop the call entirely).
const AUTOMATION_TOOL_APPROVAL_DENIAL =
  'Tool approvals are not available in unattended automation runs.'

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

async function admitAutomationSourceStep(input: AutomationAgentTurnInput & {
  originWorkflowRunId: string
  actorUserId?: string
  conversationId?: string
}) {
  'use step'
  const server = getOverlayServerContext()
  const settings = await server.appData.repositories.conversations.getAppSettings({ userId: input.userId })
  if (!isHarnessBackendReady(settings)) throw new FatalError('Harness backend is unavailable.')
  if (!input.automationId) throw new FatalError('Automation identity is required.')
  return await assertAutomationAdmissionSource({
    ...input, automationId: input.automationId, actorUserId: input.actorUserId ?? input.userId,
  })
}

async function startAutomationAgentRunStep(input: {
  conversationId: string
  modelId: string
  turnId: string
  userId: string
  userMessageId: string
}) {
  'use step'
  const run = await agentRunService.startPersonalWorkflow({
    conversationId: input.conversationId as never,
    modelId: input.modelId,
    turnId: input.turnId,
    userId: input.userId,
    userMessageId: input.userMessageId as never,
  })
  if (!run) throw new FatalError('Automation AgentRun could not be admitted.')
  return run
}

async function admitAutomationHarnessStep(input: {
  runId: string
  goal: string
  actorUserId: string
  workspaceId: string
  modelId: string
  paid: boolean
  createdAt: number
  allowedToolIds: string[]
  conversationId: string
  deliveryAgentRunId: string
}) {
  'use step'
  return await new ConvexHarnessRepository().admit({
    runId: `personal:${input.deliveryAgentRunId}`,
    goal: input.goal.slice(0, 32_000) || 'Respond to the automation instructions.',
    constraints: [],
    policy: personalHarnessPolicy({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      allowedToolIds: input.allowedToolIds,
      requiresPlan: harnessToolsRequirePlan(input.allowedToolIds),
      modelId: input.modelId,
      paid: input.paid,
      createdAt: input.createdAt,
    }),
    source: { conversationId: input.conversationId },
    deliveryAgentRunId: input.deliveryAgentRunId,
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

async function callModelStep(args: {
  instructions: string
  maxOutputTokens: number
  messages: ModelMessage[]
  modelId: string
  providerOptions?: Record<string, Record<string, unknown>>
  toolDefinitions: AutomationAgentTurnPlan['toolDefinitions']
  conversationId: string
  userId: string
}): Promise<AutomationModelCallResult> {
  'use step'
  return await callDurableAutomationModel(args)
}

async function finalizeTurnStep(args: {
  input: AutomationAgentTurnInput & { conversationId: string }
  plan: AutomationAgentTurnPlan
  steps: StepResult<ToolSet>[]
  text: string
  toolFailures?: Array<{ toolCallId: string; toolName: string; error: string }>
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
  toolFailures?: Array<{ toolCallId: string; toolName: string; error: string }>
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
): Promise<{ conversationId: string; replyText: string }> {
  if (input.surface) return await runDurableAgentTurn(input as AutomationAgentTurnInput & { conversationId: string; workspaceId: string })
  const { workflowRunId } = getWorkflowMetadata()
  const source = await admitAutomationSourceStep({
    ...input, actorUserId: input.userId, originWorkflowRunId: workflowRunId,
  })
  const ensured = await ensureConversationStep(input)
  const turnInput = { ...input, conversationId: ensured.conversationId, workspaceId: ensured.workspaceId }
  await admitAutomationSourceStep({
    ...turnInput, actorUserId: input.userId, originWorkflowRunId: workflowRunId,
  })
  const plan = await prepareTurnStep(turnInput)
  const agentRun = await startAutomationAgentRunStep({
    conversationId: plan.conversationId, modelId: plan.effectiveModelId, turnId: input.turnId,
    userId: input.userId, userMessageId: plan.userMessageId,
  })
  const access = {
    actorUserId: input.userId, runId: `personal:${agentRun.id}`, workflowRunId,
    conversationId: plan.conversationId, agentRunId: agentRun.id, workspaceId: ensured.workspaceId,
    principalId: source.principalId,
    authentication: {
      type: 'automation' as const, automationId: input.automationId!,
      ...(input.runId ? { automationRunId: input.runId } : {}),
      originWorkflowRunId: workflowRunId,
    },
  }
  const admitted = await admitAutomationHarnessStep({
    runId: input.runId ?? input.turnId, goal: input.instructions, actorUserId: input.userId,
    workspaceId: ensured.workspaceId, modelId: plan.effectiveModelId, paid: plan.paid,
    createdAt: agentRun.createdAt, allowedToolIds: plan.toolDefinitions.map(tool => tool.name),
    conversationId: plan.conversationId, deliveryAgentRunId: agentRun.id,
  })
  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) {
    return { conversationId: plan.conversationId, replyText: '' }
  }
  const result = await personalHarnessWorkflow({
    access,
    context: plan.toolingContext,
    definitions: plan.toolDefinitions,
    instructions: plan.instructions,
    messages: plan.messages,
    modelCandidates: [plan.effectiveModelId],
    delivery: { emitWebhook: false, sourceCitations: plan.sourceCitations, closeStream: false },
  })
  if (result.status === 'completed' && input.runId) {
    await automationService.markRunCompleted({ runId: input.runId, userId: input.userId, conversationId: plan.conversationId })
  } else if (result.status === 'failed' && input.runId) {
    await automationService.markRunFailed({ runId: input.runId, userId: input.userId, error: 'Automation Harness execution failed.' })
  }
  return { conversationId: plan.conversationId, replyText: 'replyText' in result ? result.replyText ?? '' : '' }
}

/**
 * The durable prepare → model/tool loop → finalize sequence, shared by the
 * automation workflow and the surface (Slack) workflow. Must be invoked from
 * a `'use workflow'` scope — the steps inside it are what make the turn
 * durable. Returns the final assistant text so surface callers can relay it
 * back to the platform.
 */
export async function runDurableAgentTurn(
  turnInput: AutomationAgentTurnInput & { conversationId: string; workspaceId: string },
): Promise<{ conversationId: string; replyText: string }> {
  if (!turnInput.surface) throw new FatalError('The legacy durable agent loop is reserved for surface turns.')
  const { workflowRunId } = getWorkflowMetadata()
  const input = turnInput

  let plan: AutomationAgentTurnPlan | undefined
  const allSteps: StepResult<ToolSet>[] = []
  const turnToolFailures: Array<{ toolCallId: string; toolName: string; error: string }> = []
  try {
    plan = await prepareTurnStep(turnInput)
    const resolvedPlan = plan
    const automationRunId = input.runId ?? input.turnId

    let messages: ModelMessage[] = resolvedPlan.messages
    for (let stepIndex = 0; stepIndex < MAX_TOOL_STEPS_ACT; stepIndex += 1) {
      const call = await callModelStep({
        instructions: resolvedPlan.instructions,
        maxOutputTokens: MAX_ACT_OUTPUT_TOKENS_PER_STEP,
        messages,
        modelId: resolvedPlan.effectiveModelId,
        providerOptions: resolvedPlan.providerOptions,
        toolDefinitions: resolvedPlan.toolDefinitions,
        conversationId: resolvedPlan.conversationId,
        userId: input.userId,
      })

      // Each tool call is its own durable step. Approval-gated calls are
      // evaluated, then denied outright — unattended runs have no human to
      // resume a hook.
      const toolResultContent: Array<Record<string, unknown>> = []
      const stepToolResults: Array<Record<string, unknown>> = []
      const stepContent: Array<Record<string, unknown>> = []
      const toolContexts = call.toolCalls.map((toolCall) => ({
        ...resolvedPlan.toolingContext,
        automationRunId,
        toolName: toolCall.toolName,
      }))
      const toolDefinitionsByName = new Map(resolvedPlan.toolDefinitions.map((entry) => [entry.name, entry]))
      const toolCallDefinitions = call.toolCalls.map((toolCall) =>
        toolDefinitionsByName.get(toolCall.toolName))
      const toolCallApprovals = await Promise.all(call.toolCalls.map(async (toolCall, i) => {
        const definition = toolCallDefinitions[i]
        if (!definition?.needsApproval) return false
        return personalChatWorkToolNeedsApproval(toolCall.input, {
          context: toolContexts[i]!,
          messages,
          toolCallId: toolCall.toolCallId,
        })
      }))
      const toolCallResults = await Promise.all(call.toolCalls.map(async (toolCall, i) => {
        const definition = toolCallDefinitions[i]
        const context = toolContexts[i]!
        let output: Record<string, unknown>
        let transcriptResult: Record<string, unknown>
        let failure: { toolCallId: string; toolName: string; error: string } | null = null
        if (!definition) {
          const reason = `Tool ${toolCall.toolName} is not available for this run.`
          output = { type: 'error-text', value: reason }
          transcriptResult = {
            type: 'tool-error',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            error: reason,
            output: { error: reason },
          }
          failure = {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            error: reason,
          }
        } else if (toolCallApprovals[i]) {
          output = { type: 'execution-denied', reason: AUTOMATION_TOOL_APPROVAL_DENIAL }
          transcriptResult = {
            type: 'tool-error',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            error: AUTOMATION_TOOL_APPROVAL_DENIAL,
            output: { error: AUTOMATION_TOOL_APPROVAL_DENIAL },
          }
          failure = {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            error: AUTOMATION_TOOL_APPROVAL_DENIAL,
          }
        } else {
          try {
            const result = await executePersonalChatWorkTool(toolCall.input, {
              context,
              messages,
              toolCallId: toolCall.toolCallId,
            })
            output = typeof result === 'string'
              ? { type: 'text', value: result }
              : { type: 'json', value: result as never }
            transcriptResult = {
              type: 'tool-result',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
              output: result,
            }
          } catch (toolError) {
            // A failed tool is fed back to the model (streamText parity) —
            // it does not fail the turn.
            const reason = toolError instanceof Error ? toolError.message : 'Tool execution failed'
            output = { type: 'error-text', value: reason }
            transcriptResult = {
              type: 'tool-error',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
              error: reason,
              output: { error: reason },
            }
            failure = {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              error: reason,
            }
          }
        }
        return { failure, output, transcriptResult }
      }))
      for (const [i, toolCall] of call.toolCalls.entries()) {
        const { failure, output, transcriptResult } = toolCallResults[i]!
        stepContent.push({ type: 'tool-call', ...toolCall })
        if (failure) turnToolFailures.push(failure)
        stepToolResults.push(transcriptResult)
        stepContent.push(transcriptResult)
        toolResultContent.push({
          type: 'tool-result',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output,
        })
      }

      // A StepResult-shaped record per model call — the same shape the act
      // route and persistence layer consume for transcripts, metrics, and
      // usage accounting.
      allSteps.push({
        content: stepContent,
        finishReason: call.finishReason,
        reasoning: call.reasoning,
        reasoningText: call.reasoningText,
        response: {
          messages: call.responseMessages,
          modelId: call.routedModelId,
        },
        text: call.text,
        toolCalls: call.toolCalls.map((entry) => ({ type: 'tool-call', ...entry })),
        toolResults: stepToolResults,
        usage: call.usage,
      } as unknown as StepResult<ToolSet>)

      if (call.toolCalls.length === 0) {
        await finalizeTurnStep({
          input: turnInput,
          plan: resolvedPlan,
          steps: allSteps,
          text: call.text,
          toolFailures: turnToolFailures,
          workflowRunId,
        })
        return { conversationId: resolvedPlan.conversationId, replyText: call.text }
      }

      // response.messages holds only the messages generated this call (the
      // assistant message with tool-call parts) — history must carry forward.
      messages = [
        ...messages,
        ...call.responseMessages,
        { role: 'tool', content: toolResultContent as never },
      ]
    }
    throw new FatalError(
      `Automation run exceeded ${MAX_TOOL_STEPS_ACT} model steps without finishing.`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown workflow failure'
    await failTurnStep({
      input: turnInput,
      plan,
      steps: allSteps,
      error: message,
      toolFailures: turnToolFailures,
      workflowRunId,
    })
    throw error
  }
}
