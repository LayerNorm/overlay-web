import 'server-only'

import type {
  HarnessAdmission,
  HarnessMutationInput,
  HarnessMutationResult,
  HarnessRepository,
  HarnessWait,
  HarnessWaitReference,
  HarnessWaitRequest,
} from '@overlay/agent-runtime/harness-store'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export class ConvexHarnessRepository implements HarnessRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async admit(input: HarnessAdmission): Promise<HarnessSnapshot> {
    const snapshot = await convex.mutation<HarnessSnapshot>('harness/runs:admit', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!snapshot) throw new Error('Harness admission returned no snapshot.')
    return snapshot
  }

  async get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null> {
    return await convex.query<HarnessSnapshot | null>('harness/runs:get', {
      actorUserId: input.actorUserId, runId: input.runId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async getSurfaceExecutionByHarnessRunId(harnessRunId: string): Promise<SurfaceTurnExecution | null> {
    return await convex.query<SurfaceTurnExecution | null>('surfaces/surfaceExecutions:getSurfaceTurnExecutionByHarnessRunId', {
      harnessRunId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async beginSurfaceTurn(input: {
    turnId: string; workflowRunId: string; actorUserId: string; workspaceId: string; creatorPrincipalId: string
    agentId: string; agentPrincipalId: string; platform: 'slack'; teamId: string; channelId: string
    threadId: string; messageId: string; bindingId: string; connectionId: string; conversationId: string
    userContent: string; modelId: string; importedAuthorName?: string; importedAuthorEmail?: string
    importedAuthorStatus?: 'member' | 'invited' | 'not_invited'; placeholderTs?: string
  }): Promise<{
    owner: 'same' | 'foreign'
    execution: SurfaceTurnExecution | null
  }> {
    const result = await convex.mutation<{
      owner: 'same' | 'foreign'
      execution: SurfaceTurnExecution | null
    }>('surfaces/surfaceExecutions:beginSurfaceTurn', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Surface turn admission returned no result.')
    return result
  }

  async failOwnedSurfaceTurn(input: {
    turnId: string
    workflowRunId: string
    agentRunId: string
    assistantMessageId: string
  }): Promise<{ persisted: boolean }> {
    const result = await convex.mutation<{ persisted: boolean }>('surfaces/surfaceExecutions:failOwnedSurfaceTurn', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Surface failure persistence returned no result.')
    return result
  }

  async apply(input: HarnessMutationInput): Promise<HarnessMutationResult> {
    const result = await convex.mutation<HarnessMutationResult>('harness/runs:apply', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Harness mutation returned no result.')
    return result
  }

  async readEvidence(
    input: { actorUserId: string; runId: string; evidenceId: string },
  ): Promise<HarnessEvidence | null> {
    return await convex.query<HarnessEvidence | null>('harness/runs:readEvidence', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async publishWait(
    input: HarnessWaitReference & { request: HarnessWaitRequest },
  ): Promise<HarnessWait> {
    const wait = await convex.mutation<HarnessWait>('harness/runs:publishWait', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId, request: input.request,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!wait) throw new Error('Harness wait publication returned no wait.')
    return wait
  }

  async resolveWait(input: HarnessWaitReference & { token: string }): Promise<void> {
    await convex.mutation<void>('harness/runs:resolveWait', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId, token: input.token,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async listPendingWaits(input: HarnessWaitReference): Promise<HarnessWait[]> {
    const waits = await convex.query<HarnessWait[]>('harness/runs:listPendingWaits', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!waits) throw new Error('Harness pending wait query returned no result.')
    return waits
  }

  async listDeliveryWorkflowRuns(input: {
    actorUserId: string
    agentRunId: string
    rootRunId: string
    cursor: string | null
  }): Promise<{ workflowRunIds: string[]; cursor: string; isDone: boolean }> {
    const page = await convex.query<{ workflowRunIds: string[]; cursor: string; isDone: boolean }>(
      'harness/runs:listDeliveryWorkflowRuns',
      {
        actorUserId: input.actorUserId,
        agentRunId: input.agentRunId,
        rootRunId: input.rootRunId,
        cursor: input.cursor,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
    if (!page) throw new Error('Harness workflow cleanup query returned no result.')
    return {
      workflowRunIds: page.workflowRunIds,
      cursor: page.cursor,
      isDone: page.isDone,
    }
  }
}
