import 'server-only'

import { setTimeout as delay } from 'node:timers/promises'
import { getRun, start } from 'workflow/api'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { personalHarnessWorkflow } from '@/server/workflows/personal-harness'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { personalHarnessPolicy, type PersonalHarnessBudget } from './personal-admission-policy'
import { recordPublicStreamMetric } from './public-stream-metrics'
import type { PersonalHarnessWorkflowInput } from './personal-workflow-input'

export class PersonalHarnessAdmissionConflict extends Error {}
export class PersonalHarnessStartPending extends Error {}

export type PersonalHarnessAcceptedRun = {
  accepted: true
  runId: string
  executionGeneration: number
}

export function personalHarnessAuthentication(auth: AuthenticatedAppUser): PersonalHarnessWorkflowInput['access']['authentication'] {
  if (auth.authType === 'api-key' && auth.apiKeyId) return { type: 'api-key', apiKeyId: auth.apiKeyId }
  if (auth.authType === 'session' || auth.authType === 'access-token') return { type: auth.authType }
  throw new Error('Personal harness authentication is not supported.')
}

type StartPersonalHarnessInput = {
  workflow: PersonalHarnessWorkflowInput
  agentRun: AgentRun
  paid: boolean
  goal: string
  budget?: PersonalHarnessBudget
  onAdmitted?: () => void
}

async function enqueuePersonalHarnessAdmission(
  input: StartPersonalHarnessInput,
  repository: ConvexHarnessRepository,
  runId: string,
) {
  const { workflow, agentRun } = input
  try {
    const existing = await repository.get({ actorUserId: workflow.access.actorUserId, runId })
    return await repository.admit({
      runId,
      goal: input.goal.trim().length > 32_000
        ? `${input.goal.trim().slice(0, 31_900)}\nRead the full request in the latest user message.`
        : input.goal.trim() || 'Respond to the latest user message and its attachments.',
      constraints: [],
      source: { conversationId: workflow.access.conversationId },
      deliveryAgentRunId: agentRun.id,
      policy: personalHarnessPolicy({
        actorUserId: workflow.access.actorUserId,
        workspaceId: workflow.access.workspaceId,
        allowedToolIds: workflow.definitions.map(definition => definition.name),
        modelId: workflow.context.effectiveModelId,
        paid: input.paid,
        createdAt: agentRun.createdAt,
        budget: input.budget,
        existingPolicy: existing?.policy,
      }),
    })
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('HARNESS_ADMISSION_CONFLICT')) {
      throw new PersonalHarnessAdmissionConflict('This turn is already admitted with different immutable settings.', { cause })
    }
    throw cause
  }
}

async function startPersonalHarnessWorkflow(
  workflow: PersonalHarnessWorkflowInput,
  publicStreamVersion?: number,
): Promise<boolean> {
  const attempts = publicStreamVersion === 1 ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await start(personalHarnessWorkflow, [workflow])
      return true
    } catch (cause) {
      if (attempt > 0 || publicStreamVersion !== 1) {
        throw new PersonalHarnessStartPending(
          'The workflow start could not be confirmed. Retry this turn to reconnect safely.', { cause },
        )
      }
    }
  }
  return false
}

async function pollLegacyWorkflowClaim(
  repository: ConvexHarnessRepository,
  agentRun: AgentRun,
  runId: string,
): Promise<Awaited<ReturnType<typeof getRun>>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await repository.get({ actorUserId: agentRun.userId, runId })
    if (state?.workflowRunId) return getRun(state.workflowRunId)
    await delay(300)
  }
  throw new PersonalHarnessStartPending(
    'The durable run is queued. Retry this turn to reconnect without starting new work.',
  )
}

function assertDelivery(input: PersonalHarnessWorkflowInput, run: AgentRun): void {
  if (run.userId !== input.access.actorUserId || run.id !== input.access.agentRunId
    || run.conversationId !== input.access.conversationId || run.mode === 'room'
    || run.turnId !== input.context.turnId || run.executionEngine !== 'overlay_harness') {
    throw new PersonalHarnessAdmissionConflict('Personal run identity changed.')
  }
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PersonalHarnessAdmissionConflict('This turn has already ended. Use a new turn ID to start another run.')
  }
  if (run.runner !== 'workflow') throw new PersonalHarnessAdmissionConflict('This turn is still owned by its original runner.')
}

export async function startPersonalHarness(input: {
  workflow: PersonalHarnessWorkflowInput
  agentRun: AgentRun
  paid: boolean
  goal: string
  budget?: PersonalHarnessBudget
  onAdmitted?: () => void
}) {
  const { workflow, agentRun } = input
  assertDelivery(workflow, agentRun)
  if (agentRun.workflowRunId && !agentRun.harnessRunId) {
    throw new PersonalHarnessAdmissionConflict('This turn is still owned by its original workflow. Reconnect to the existing run.')
  }
  const repository = new ConvexHarnessRepository()
  const runId = `personal:${agentRun.id}`
  if (workflow.access.runId !== runId || (agentRun.harnessRunId && agentRun.harnessRunId !== runId)) {
    throw new PersonalHarnessAdmissionConflict('Personal root identity changed.')
  }
  const admitted = await enqueuePersonalHarnessAdmission(input, repository, runId)
  input.onAdmitted?.()
  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) throw new PersonalHarnessAdmissionConflict('This harness run has already ended.')
  const publicStreamVersion = admitted.policy?.publicStreamVersion
  const isVersioned = publicStreamVersion === 1
  if (isVersioned) recordPublicStreamMetric({
    event: 'admission_accepted', runId, generation: admitted.executionGeneration ?? 0,
    modelId: workflow.context.effectiveModelId,
  })
  if (isVersioned && admitted.workflowRunId) {
    return {
      accepted: true,
      runId,
      executionGeneration: admitted.executionGeneration ?? 0,
    } satisfies PersonalHarnessAcceptedRun
  }
  if (admitted.workflowRunId) return getRun(admitted.workflowRunId)
  // A lost start acknowledgement is retriable. Only the workflow that atomically
  // claims the durable root can attach delivery or execute models and tools.
  const started = await startPersonalHarnessWorkflow(workflow, publicStreamVersion)
  if (isVersioned) {
    return {
      accepted: true,
      runId,
      executionGeneration: admitted.executionGeneration ?? 0,
    } satisfies PersonalHarnessAcceptedRun
  }
  if (!started) throw new PersonalHarnessStartPending('The workflow start could not be confirmed.')
  return pollLegacyWorkflowClaim(repository, agentRun, runId)
}
