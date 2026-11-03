import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { PersonalHarnessAccess } from './personal-access'

/**
 * Body of the step, shared by the combined admission step. It lives outside
 * the step module because the workflow compiler strips step bodies but keeps
 * plain exports, which would pull these server imports into workflow bundles.
 */
export async function attachPersonalDelivery(access: PersonalHarnessAccess): Promise<void> {
  const state = await new ConvexHarnessRepository().get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId) throw new FatalError('Invalid root delivery authority.')
  const current = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  if (!current || current.id !== access.agentRunId || current.userId !== access.actorUserId
    || current.conversationId !== access.conversationId || current.harnessRunId !== state.runId
    || current.runner !== 'workflow' || current.executionEngine !== 'overlay_harness' || current.mode === 'room'
    || (current.workflowRunId && current.workflowRunId !== access.workflowRunId)) throw new FatalError('Invalid personal delivery run.')
  const run = await agentRunService.attachWorkflow({
    runId: access.agentRunId, userId: access.actorUserId, workflowRunId: access.workflowRunId,
  })
  if (!run || run.conversationId !== access.conversationId || run.harnessRunId !== state.runId
    || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness'
    || run.workflowRunId !== access.workflowRunId || run.mode === 'room') throw new FatalError('Invalid personal delivery run.')
}
