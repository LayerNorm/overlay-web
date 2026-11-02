import 'server-only'

import { createHash } from 'node:crypto'
import { FatalError } from 'workflow'
import type { HarnessResourcePauseInput, HarnessResourceRequestReference } from '@overlay/agent-runtime/harness-resource'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessResourceConsumption, HarnessResourcePublication } from './resource-waits'

export async function createHarnessResourceToken(input: {
  runId: string
  workflowRunId: string
  expectedRevision: number
}): Promise<string> {
  'use step'
  return `resource:${createHash('sha256').update(JSON.stringify([
    input.runId, input.workflowRunId, input.expectedRevision,
  ])).digest('hex')}`
}

async function isInactive(repository: ConvexHarnessRepository, reference: HarnessResourceRequestReference): Promise<boolean> {
  const state = await repository.get({ actorUserId: reference.actorUserId, runId: reference.runId })
  if (!state || state.workflowRunId !== reference.workflowRunId || state.policy.actorUserId !== reference.actorUserId
    || state.policy.resourcePauseVersion !== 1 || state.parentRunId || state.rootRunId !== reference.runId) {
    throw new FatalError('HARNESS_RESOURCE_WAIT_NOT_OWNED')
  }
  if (['completed', 'cancelled', 'failed'].includes(state.status)) return true
  if (state.status === 'waiting_for_resources' && state.resourceRequestToken !== reference.token) {
    throw new FatalError('HARNESS_RESOURCE_WAIT_CHANGED')
  }
  return false
}

export async function publishHarnessResourceWait(input: HarnessResourcePauseInput): Promise<HarnessResourcePublication> {
  'use step'
  const repository = new ConvexHarnessRepository()
  if (await isInactive(repository, input)) return 'inactive'
  try {
    await repository.pauseForResources(input)
    return 'paused'
  } catch (error) {
    if (await isInactive(repository, input)) return 'inactive'
    if (error instanceof Error && /\bHARNESS_(?:STATE_CONFLICT|RESOURCE_NOT_EXHAUSTED)\b/.test(error.message)) return 'retry'
    throw error
  }
}

export async function consumeHarnessResourceWait(reference: HarnessResourceRequestReference): Promise<HarnessResourceConsumption> {
  'use step'
  const repository = new ConvexHarnessRepository()
  if (await isInactive(repository, reference)) return 'inactive'
  try {
    return (await repository.consumeResourceGrant(reference)).status
  } catch (error) {
    if (await isInactive(repository, reference)) return 'inactive'
    throw error
  }
}
