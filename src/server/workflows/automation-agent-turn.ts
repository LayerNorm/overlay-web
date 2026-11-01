/**
 * Automation turn admission into the shared personal Harness lifecycle.
 * Invoked by durable workflows; all repository and provider effects stay in
 * independently retryable steps.
 */

import { FatalError, RetryableError, getWorkflowMetadata } from 'workflow'
import {
  AutomationTurnError,
  prepareAutomationAgentTurn,
  type AutomationAgentTurnInput,
  type AutomationAgentTurnPlan,
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

// Preparation is a durable step; provider and tool dispatch now use the
// shared personal Harness workflow.

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
