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
import { FatalError, RetryableError, getWorkflowMetadata } from 'workflow'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import { MAX_TOOL_STEPS_ACT } from '@/server/tools/tools/policy'
import { MAX_ACT_OUTPUT_TOKENS_PER_STEP } from '@/server/app-api/v1/conversations/act/route-helpers'
import {
  AutomationTurnError,
  callDurableAutomationModel,
  failAutomationAgentTurn,
  finalizeAutomationAgentTurn,
  prepareAutomationAgentTurn,
  type AutomationAgentTurnInput,
  type AutomationAgentTurnPlan,
  type AutomationModelCallResult,
} from '@/server/automations/automation-turn-runner'
import { assertAutomationAdmissionSource } from '@/server/harness/automation-access'
import {
  admitAutomationHarnessStep,
  admitAutomationSourceStep,
  ensureConversationStep,
  readAutomationDeliveryStep,
  reconcileAutomationHarnessTerminalStep,
  settleOwnedAutomationRunStep,
  startAutomationAgentRunStep,
  startAutomationRunStep,
} from './automation-harness-steps'
import { personalHarnessWorkflow } from './personal-harness'

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

async function prepareTurnStep(
  input: AutomationAgentTurnInput & { conversationId: string; workspaceId: string },
): Promise<AutomationAgentTurnPlan> {
  'use step'
  try {
    if (!input.surface) {
      if (!input.automationId || !input.originWorkflowRunId) {
        throw new FatalError('Automation source identity is required.')
      }
      await assertAutomationAdmissionSource({
        automationId: input.automationId,
        actorUserId: input.userId,
        originWorkflowRunId: input.originWorkflowRunId,
        runId: input.runId,
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        turnId: input.turnId,
      })
    }
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

// ---------------------------------------------------------------------------
// Orchestrator — called from 'use workflow' functions; runs in workflow scope.
// ---------------------------------------------------------------------------

type AutomationTurnResult = { conversationId: string; replyText: string; status: string }

function projectAutomationTurnResult(
  conversationId: string,
  status: string,
  replyText = '',
): AutomationTurnResult {
  return { conversationId, replyText, status }
}

function isTerminalAutomationStatus(
  status: string,
): status is 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

async function replayTerminalAutomationResult(args: {
  automationId: string
  agentRunId: string
  conversationId: string
  runId?: string
  turnId: string
  userId: string
  workflowRunId: string
  status: 'completed' | 'failed' | 'cancelled'
  terminalReason?: string
}): Promise<AutomationTurnResult> {
  const replyText = await readAutomationDeliveryStep({
    conversationId: args.conversationId, agentRunId: args.agentRunId, userId: args.userId,
  })
  const settled = await settleOwnedAutomationRunStep({
    automationId: args.automationId, runId: args.runId, userId: args.userId,
    workflowRunId: args.workflowRunId, turnId: args.turnId, status: args.status,
    conversationId: args.conversationId, error: args.terminalReason,
  })
  if (args.runId && !settled) return projectAutomationTurnResult(args.conversationId, 'already_running')
  return projectAutomationTurnResult(args.conversationId, args.status, replyText)
}

type PreparedAutomationTurn = {
  source: Awaited<ReturnType<typeof admitAutomationSourceStep>>
  turnInput: AutomationAgentTurnInput & { conversationId: string; workspaceId: string }
  plan: AutomationAgentTurnPlan
}

async function prepareAutomationTurn(
  input: AutomationAgentTurnInput,
  workflowRunId: string,
): Promise<PreparedAutomationTurn> {
  let source: PreparedAutomationTurn['source'] | undefined
  let turnInput: PreparedAutomationTurn['turnInput']
  let plan: AutomationAgentTurnPlan | undefined
  const canonicalInput: AutomationAgentTurnInput = {
    ...input,
    turnId: input.runId ? `automation-run:${input.runId}` : input.turnId,
  }
  try {
    source = await admitAutomationSourceStep({
      ...canonicalInput, actorUserId: input.userId, originWorkflowRunId: workflowRunId,
    })
    const authorizedInput = {
      ...canonicalInput,
      originWorkflowRunId: workflowRunId,
      conversationId: source.conversationId,
      turnId: source.turnId,
      workspaceId: source.workspaceId,
    }
    const ensured = await ensureConversationStep(authorizedInput)
    turnInput = {
      ...authorizedInput, conversationId: ensured.conversationId, workspaceId: ensured.workspaceId,
    }
    source = await startAutomationRunStep({
      automationId: input.automationId!, runId: input.runId, userId: input.userId,
      workflowRunId, conversationId: ensured.conversationId, turnId: source.turnId,
      workspaceId: ensured.workspaceId,
    })
    turnInput = {
      ...turnInput,
      conversationId: source.conversationId ?? ensured.conversationId,
      turnId: source.turnId,
    }
    plan = await prepareTurnStep(turnInput)
  } catch (error) {
    if (error instanceof RetryableError) throw error
    const settled = await settleOwnedAutomationRunStep({
      automationId: input.automationId!, runId: input.runId, userId: input.userId,
      workflowRunId, status: 'failed',
      error: error instanceof Error ? error.message : 'Automation admission failed.',
    })
    if (input.runId && !settled && source) {
      throw new FatalError('Automation run failure could not be settled by its owner.')
    }
    throw error
  }
  if (!source || !plan) throw new FatalError('Automation preparation did not complete.')
  return { source, turnInput: turnInput!, plan }
}

async function claimAutomationHarnessTurn(
  input: AutomationAgentTurnInput,
  workflowRunId: string,
  source: PreparedAutomationTurn['source'],
  turnInput: PreparedAutomationTurn['turnInput'],
  plan: AutomationAgentTurnPlan,
) {
  const agentRun = await startAutomationAgentRunStep({
    conversationId: plan.conversationId, modelId: plan.effectiveModelId, turnId: turnInput.turnId,
    userId: input.userId, userMessageId: plan.userMessageId,
  })
  if (agentRun.workflowRunId && agentRun.workflowRunId !== workflowRunId) {
    return { status: 'already_running' as const, conversationId: plan.conversationId }
  }
  const access = {
    actorUserId: input.userId, runId: `personal:${agentRun.id}`, workflowRunId,
    conversationId: plan.conversationId, agentRunId: agentRun.id, workspaceId: source.workspaceId,
    principalId: source.principalId,
    authentication: {
      type: 'automation' as const, automationId: input.automationId!,
      ...(input.runId ? { automationRunId: input.runId } : {}),
      originWorkflowRunId: workflowRunId,
    },
  }
  const admitted = await admitAutomationHarnessStep({
    runId: input.runId ?? turnInput.turnId, goal: input.instructions, actorUserId: input.userId,
    workspaceId: source.workspaceId, modelId: plan.effectiveModelId, paid: plan.paid,
    createdAt: agentRun.createdAt, allowedToolIds: plan.toolDefinitions.map(tool => tool.name),
    conversationId: plan.conversationId, deliveryAgentRunId: agentRun.id,
  })
  if (admitted.workflowRunId && admitted.workflowRunId !== workflowRunId) {
    return { status: 'already_running' as const, conversationId: plan.conversationId }
  }
  return { status: 'admitted' as const, access, agentRun, admitted }
}

type AutomationHarnessClaim = Extract<
  Awaited<ReturnType<typeof claimAutomationHarnessTurn>>,
  { status: 'admitted' }
>

async function runAdmittedAutomationHarness(
  input: AutomationAgentTurnInput,
  workflowRunId: string,
  turnInput: PreparedAutomationTurn['turnInput'],
  plan: AutomationAgentTurnPlan,
  claim: AutomationHarnessClaim,
): Promise<AutomationTurnResult> {
  let result: Awaited<ReturnType<typeof personalHarnessWorkflow>>
  try {
    result = await personalHarnessWorkflow({
      access: claim.access,
      context: plan.toolingContext,
      definitions: plan.toolDefinitions,
      instructions: plan.instructions,
      messages: plan.messages,
      modelCandidates: [plan.effectiveModelId],
      delivery: { emitWebhook: false, sourceCitations: plan.sourceCitations, closeStream: false },
    })
  } catch (error) {
    const reconciled = await reconcileAutomationHarnessTerminalStep({
      access: claim.access, automationId: input.automationId!, runId: input.runId,
      turnId: turnInput.turnId, userId: input.userId, workflowRunId,
    })
    if (!reconciled) throw error
    const replyText = reconciled === 'completed'
      ? await readAutomationDeliveryStep({
        conversationId: plan.conversationId, agentRunId: claim.agentRun.id, userId: input.userId,
      })
      : ''
    return projectAutomationTurnResult(plan.conversationId, reconciled, replyText)
  }
  if (result.status === 'already_running') {
    return projectAutomationTurnResult(plan.conversationId, 'already_running')
  }
  if (isTerminalAutomationStatus(result.status)) {
    const settled = await settleOwnedAutomationRunStep({
      automationId: input.automationId!,
      runId: input.runId,
      userId: input.userId,
      workflowRunId,
      turnId: turnInput.turnId,
      status: result.status,
      conversationId: plan.conversationId,
      error: result.terminalReason,
    })
    if (input.runId && !settled) return projectAutomationTurnResult(plan.conversationId, 'already_running')
  }
  return projectAutomationTurnResult(
    plan.conversationId,
    result.status,
    'replyText' in result ? result.replyText ?? '' : '',
  )
}

export async function runAutomationAgentTurn(
  input: AutomationAgentTurnInput,
): Promise<{ conversationId: string; replyText: string; status: string }> {
  if (input.surface) throw new FatalError('Surface turns must use the surface workflow.')
  const { workflowRunId } = getWorkflowMetadata()
  if (!input.automationId) throw new FatalError('Automation identity is required.')
  const prepared = await prepareAutomationTurn(input, workflowRunId)
  const claim = await claimAutomationHarnessTurn(
    input, workflowRunId, prepared.source, prepared.turnInput, prepared.plan,
  )
  if (claim.status === 'already_running') {
    return projectAutomationTurnResult(claim.conversationId, claim.status)
  }
  if (isTerminalAutomationStatus(claim.admitted.status)) {
    return await replayTerminalAutomationResult({
      automationId: input.automationId,
      agentRunId: claim.agentRun.id,
      conversationId: prepared.plan.conversationId,
      runId: input.runId,
      turnId: prepared.turnInput.turnId,
      userId: input.userId,
      workflowRunId,
      status: claim.admitted.status,
      terminalReason: claim.admitted.terminalReason,
    })
  }
  return await runAdmittedAutomationHarness(
    input, workflowRunId, prepared.turnInput, prepared.plan, claim,
  )
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
