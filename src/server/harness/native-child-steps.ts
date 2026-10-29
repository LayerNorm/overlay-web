import 'server-only'

import { createHash } from 'node:crypto'
import { FatalError, RetryableError } from 'workflow'
import type { HarnessChild } from '@overlay/agent-runtime/harness-state'
import type { HarnessDelegation } from './ports'
import type { NativeHarnessToolsInput } from './native-tools'
import { refreshNativeHarnessAccess } from './native-access'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'

export async function admitNativeHarnessChild(
  input: Pick<NativeHarnessToolsInput, 'access' | 'context'>,
  delegation: HarnessDelegation,
  toolCallId: string,
): Promise<HarnessChild> {
  'use step'
  if (!toolCallId || toolCallId.length > 256) throw new FatalError('Invalid delegation call identity.')
  await refreshNativeHarnessAccess(input.access, input.context)
  const repository = new ConvexHarnessRepository()
  const id = `child:${createHash('sha256').update(JSON.stringify([input.access.runId, toolCallId])).digest('hex')}`
  const child: HarnessChild = {
    id, stepId: delegation.stepId, allowedToolIds: [...new Set(delegation.allowedToolIds)].sort(),
    maxCostMicros: delegation.maxCostMicros, costMicros: 0, status: 'running', evidenceRefs: [],
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await repository.get(input.access)
    if (!state || state.workflowRunId !== input.access.workflowRunId
      || state.policy.actorUserId !== input.access.actorUserId
      || state.policy.workspaceId !== input.access.workspaceId) throw new FatalError('Invalid native delegation authority.')
    const result = await repository.apply({
      actorUserId: input.access.actorUserId, runId: input.access.runId,
      operationId: `delegate:${id}`, expectedRevision: state.revision,
      operation: { type: 'admit_child', child, goal: delegation.goal, constraints: delegation.constraints },
    })
    if (!result.conflict) {
      const admitted = result.snapshot.children.find(entry => entry.id === id)
      if (!admitted) throw new FatalError('Admitted child is missing.')
      return admitted
    }
  }
  throw new RetryableError('Child admission is contended.')
}
