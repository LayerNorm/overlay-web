import 'server-only'

import { gunzipSync, gzipSync } from 'node:zlib'
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
import type { HarnessRunnerCheckpoint } from './ports'
import type {
  HarnessConsumeResourceGrantInput, HarnessGrantResourcesInput, HarnessResourceConsumeResult,
  HarnessResourceGrantReceipt, HarnessResourcePauseInput, HarnessResourceRequestRecord,
  HarnessResourceRequestReference,
} from '@overlay/agent-runtime/harness-resource'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { requireNativeThreadCompatibilityBackend } from '@/server/conversations/native-thread-compatibility-backend'

export class ConvexHarnessRepository implements HarnessRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async admit(input: HarnessAdmission): Promise<HarnessSnapshot> {
    await requireNativeThreadCompatibilityBackend(input.policy.actorUserId)
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

  async submitWaitReply(input: {
    actorUserId: string; workspaceId: string; deliveryAgentRunId: string; token: string
    reply: { text: string } | { approved: boolean; reason?: string }
  }): Promise<boolean> {
    return await convex.mutation<boolean>('harness/runs:submitWaitReply', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true }) === true
  }

  async readWaitReply(input: HarnessWaitReference & { token: string }): Promise<unknown> {
    return await convex.query('harness/runs:readWaitReply', {
      actorUserId: input.actorUserId,
      runId: input.runId,
      workflowRunId: input.workflowRunId,
      token: input.token,
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
    await requireNativeThreadCompatibilityBackend(input.actorUserId)
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
    failure: { code: string; message: string; retryable: boolean }
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

  async renewLease(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    executionGeneration: number
    expectedRevision: number
    now: number
    leaseMs: number
  }): Promise<HarnessSnapshot> {
    const snapshot = await convex.mutation<HarnessSnapshot>('harness/runs:renewLease', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!snapshot) throw new Error('Harness lease renewal returned no state.')
    return snapshot
  }

  async handoffContinuation(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    executionGeneration: number
    expectedRevision: number
    workflowKind: 'native' | 'personal'
    checkpoint: HarnessRunnerCheckpoint
    launchInput: unknown
  }): Promise<HarnessSnapshot> {
    const payload = JSON.stringify({ checkpoint: input.checkpoint, launchInput: input.launchInput })
    const compressed = gzipSync(Buffer.from(payload, 'utf8'))
    const upload = await convex.mutation<{ uploadUrl: string }>('harness/continuations:generateUploadUrl', {
      actorUserId: input.actorUserId,
      serverSecret: this.serverSecret,
      runId: input.runId,
      workflowRunId: input.workflowRunId,
      executionGeneration: input.executionGeneration,
    }, { throwOnError: true })
    if (!upload?.uploadUrl) throw new Error('Harness continuation upload URL is unavailable.')
    const { uploadUrl } = upload
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/gzip' },
      body: compressed as unknown as BodyInit,
    })
    if (!uploadResponse.ok) throw new Error('Harness continuation checkpoint upload failed.')
    const uploadResult = await uploadResponse.json() as { storageId?: unknown }
    if (typeof uploadResult.storageId !== 'string') {
      throw new Error('Harness continuation checkpoint upload returned no storage id.')
    }
    const result = await convex.mutation<{
      runId: string; rootRunId: string; status: string; executionGeneration: number; revision: number; updatedAt: number
    }>('harness/continuations:handoff', {
      actorUserId: input.actorUserId,
      serverSecret: this.serverSecret,
      runId: input.runId,
      workflowRunId: input.workflowRunId,
      executionGeneration: input.executionGeneration,
      expectedRevision: input.expectedRevision,
      workflowKind: input.workflowKind,
      checkpointStorageId: uploadResult.storageId,
    }, { throwOnError: true })
    if (!result) throw new Error('Harness continuation handoff returned no projection.')
    const snapshot = await this.get({ actorUserId: input.actorUserId, runId: input.runId })
    if (!snapshot || snapshot.revision !== result.revision
      || snapshot.executionGeneration !== result.executionGeneration) {
      throw new Error('Harness continuation handoff snapshot could not be confirmed.')
    }
    return snapshot
  }

  async getContinuationLaunch(input: { runId: string; generation: number; checkpointToken: string }): Promise<{
    workflowKind: 'native' | 'personal'
    checkpointJson: string
    launchInputJson: string
  } | null> {
    const launch = await convex.query<{
      workflowKind: 'native' | 'personal'
      actorUserId: string
      workspaceId?: string
      executionGeneration: number
      checkpointStorageUrl?: string
      checkpointJson?: string
      launchInputJson?: string
    } | null>('harness/continuations:getLaunch', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!launch) return null
    let checkpointJson: string
    let launchInputJson: string
    if (launch.checkpointStorageUrl) {
      const response = await fetch(launch.checkpointStorageUrl)
      if (!response.ok) throw new Error('Harness continuation checkpoint download failed.')
      const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')) as {
        checkpoint?: unknown
        launchInput?: unknown
      }
      checkpointJson = JSON.stringify(payload.checkpoint)
      launchInputJson = JSON.stringify(payload.launchInput)
    } else if (launch.checkpointJson !== undefined && launch.launchInputJson !== undefined) {
      checkpointJson = launch.checkpointJson
      launchInputJson = launch.launchInputJson
    } else {
      throw new Error('Harness continuation checkpoint payload is missing.')
    }
    const checkpoint = JSON.parse(checkpointJson) as { version?: unknown; messages?: unknown }
    const launchInput = JSON.parse(launchInputJson) as {
      access?: { actorUserId?: unknown; workspaceId?: unknown; runId?: unknown; executionGeneration?: unknown }
    }
    if (checkpoint.version !== 1 || !Array.isArray(checkpoint.messages)
      || launchInput.access?.actorUserId !== launch.actorUserId
      || launchInput.access.workspaceId !== launch.workspaceId
      || launchInput.access.runId !== input.runId
      || launchInput.access.executionGeneration !== launch.executionGeneration
      || launch.executionGeneration !== input.generation) {
      throw new Error('Harness continuation checkpoint identity is invalid.')
    }
    return { workflowKind: launch.workflowKind, checkpointJson, launchInputJson }
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

  async pauseForResources(input: HarnessResourcePauseInput): Promise<HarnessResourceRequestRecord> {
    const request = await convex.mutation<HarnessResourceRequestRecord>('harness/runs:pauseForResources', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!request) throw new Error('Harness resource pause returned no request.')
    return request
  }

  async getResourceRequest(input: HarnessResourceRequestReference): Promise<HarnessResourceRequestRecord | null> {
    return await convex.query<HarnessResourceRequestRecord | null>('harness/runs:getResourceRequest', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async grantResources(input: HarnessGrantResourcesInput): Promise<HarnessResourceGrantReceipt> {
    const receipt = await convex.mutation<HarnessResourceGrantReceipt>('harness/runs:grantResources', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!receipt) throw new Error('Harness resource grant returned no receipt.')
    return receipt
  }

  async consumeResourceGrant(input: HarnessConsumeResourceGrantInput): Promise<HarnessResourceConsumeResult> {
    const result = await convex.mutation<HarnessResourceConsumeResult>('harness/runs:consumeResourceGrant', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Harness resource consumption returned no result.')
    return result
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
