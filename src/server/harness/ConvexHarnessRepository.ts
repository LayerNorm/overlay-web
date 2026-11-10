import 'server-only'

import { gunzipSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { compactTranscriptSnapshot } from './transcript-snapshot'
import type {
  HarnessAdmission,
  HarnessMutationInput,
  HarnessMutationResult,
  HarnessRepository,
  HarnessWait,
  HarnessWaitReference,
  HarnessWaitRequest,
  HarnessTranscriptPage,
  HarnessTranscriptPersistence,
} from '@overlay/agent-runtime/harness-store'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessArtifactMetadata } from './artifact-context'
import type { HarnessRunnerCheckpoint } from './ports'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'
import type { ActivePublicStreamSnapshot } from '@/shared/chat/public-stream-projection'
import { api } from '../../../convex/_generated/api'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { requireNativeThreadCompatibilityBackend } from '@/server/conversations/native-thread-compatibility-backend'
import { artifactClient, ConvexHarnessAssignments } from './ConvexHarnessAssignments'

export class ConvexHarnessRepository extends ConvexHarnessAssignments implements HarnessRepository {

  async storeContextArtifact(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    artifactId: string
    toolCallId: string
    toolName: string
    digest: string
    data: Uint8Array
    mediaPartCount: number
    resource?: { id: string; revision?: string; operation?: string; page?: number }
  }): Promise<HarnessArtifactMetadata> {
    const client = artifactClient()
    const identity = {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId,
      serverSecret: this.serverSecret,
    }
    const uploadUrl = await client.action(api.harness.artifacts.beginUpload, identity)
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: input.data.slice().buffer as ArrayBuffer,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error('Harness artifact upload failed.')
    const uploaded = await response.json() as { storageId?: string }
    if (typeof uploaded.storageId !== 'string') throw new Error('Harness artifact upload returned no storage identity.')
    return await client.action(api.harness.artifacts.attachUploaded, {
      ...identity,
      artifactId: input.artifactId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      digest: input.digest,
      storageId: uploaded.storageId as never,
      byteSize: input.data.byteLength,
      mediaPartCount: input.mediaPartCount,
      ...(input.resource ? { resource: input.resource } : {}),
    })
  }

  async getContextArtifactMetadata(input: {
    actorUserId: string; runId: string; workflowRunId: string; artifactId: string
  }): Promise<HarnessArtifactMetadata | null> {
    return await artifactClient().query(api.harness.artifactMetadata.getMetadataForServer, {
      ...input, serverSecret: this.serverSecret,
    })
  }

  async readContextArtifact(input: {
    actorUserId: string; runId: string; workflowRunId: string; artifactId: string
  }): Promise<Uint8Array | null> {
    const client = artifactClient()
    const metadata = await this.getContextArtifactMetadata(input)
    if (!metadata) return null
    const parts: Uint8Array[] = []
    for (let offset = 0; offset < metadata.byteSize; offset += 256 * 1024) {
      const part = await client.action(api.harness.artifacts.readChunk, {
        ...input, serverSecret: this.serverSecret, offset,
        length: Math.min(256 * 1024, metadata.byteSize - offset),
      })
      if (!part) throw new Error('Harness artifact content is unavailable.')
      parts.push(new Uint8Array(part))
    }
    const result = new Uint8Array(metadata.byteSize)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.byteLength
    }
    if (offset !== metadata.byteSize) throw new Error('Harness artifact content is incomplete.')
    return result
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

  async appendPublicStream(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    executionGeneration: number
    receiptId: string
    modelId: string
    sequence: number
    text: string
  }): Promise<{ accepted: boolean; duplicate: boolean; truncated: boolean }> {
    const result = await convex.mutation<{ accepted: boolean; duplicate: boolean; truncated: boolean }>(
      'harness/runs:appendPublicStream',
      { ...input, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!result) throw new Error('Harness public stream write returned no result.')
    return result
  }

  async readPublicStreamState(input: { actorUserId: string; runId: string; afterSequence: number }): Promise<{
    status: string
    workflowRunId: string | null
    executionGeneration: number
    snapshot: ActivePublicStreamSnapshot | null
    transcriptSteps: Array<{
      receiptId: string
      sequence: number
      executionGeneration: number
      persistence: { content: string; parts: Array<Record<string, unknown>> }
    }>
    nextSequence: number | null
  } | null> {
    return await convex.query('harness/runs:readPublicStreamState', {
      ...input, serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null> {
    return await convex.query<HarnessSnapshot | null>('harness/runs:get', {
      actorUserId: input.actorUserId, runId: input.runId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async refreshRoomContextRestrictions(input: { actorUserId: string; runId: string }): Promise<{ inheritedSharedRoom: boolean }> {
    const restrictions = await convex.mutation<{ inheritedSharedRoom: boolean }>('harness/runs:refreshRoomContextRestrictions', {
      ...input,
      serverSecret: this.serverSecret,
    })
    if (!restrictions) throw new Error('Harness room restrictions are unavailable.')
    return restrictions
  }

  async resolveConversationRoomRestrictions(input: { actorUserId: string; workspaceId: string; conversationId: string }): Promise<{ inheritedSharedRoom: boolean }> {
    const restrictions = await convex.mutation<{ inheritedSharedRoom: boolean }>('harness/runs:resolveConversationRoomRestrictions', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!restrictions) throw new Error('Conversation room restrictions are unavailable.')
    return restrictions
  }

  async writeTranscriptStep(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    receiptId: string
    stepNumber: number
    persistence: HarnessTranscriptPersistence
  }): Promise<{ persisted: boolean }> {
    const identity = { actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId,
      receiptId: input.receiptId, serverSecret: this.serverSecret }
    const serialized = JSON.stringify(input.persistence)
    const uploadUrl = await convex.mutation<string>('harness/runs:beginTranscriptUpload', identity, { throwOnError: true })
    if (!uploadUrl) throw new Error('Harness transcript upload returned no URL.')
    const bytes = gzipSync(serialized)
    const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/gzip' },
      body: Uint8Array.from(bytes).buffer, redirect: 'error', signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error('Harness transcript upload failed.')
    const uploaded = await response.json() as { storageId?: string }
    if (typeof uploaded.storageId !== 'string') throw new Error('Harness transcript upload returned no storage identity.')
    try {
      const result = await convex.mutation<{ persisted: boolean }>('harness/runs:writeTranscriptStep', {
        ...input, serverSecret: this.serverSecret,
        persistence: compactTranscriptSnapshot(input.persistence),
        fullPersistenceStorageId: uploaded.storageId,
        fullPersistenceDigest: createHash('sha256').update(serialized).digest('hex'),
      }, { throwOnError: true })
      if (!result) throw new Error('Harness transcript persistence returned no result.')
      return result
    } finally {
      // Also cleans up a duplicate upload after an idempotent workflow replay.
      await convex.mutation('harness/runs:discardTranscriptUpload', {
        ...identity, storageId: uploaded.storageId,
      }, { throwOnError: true }).catch((_error) => undefined)
    }
  }

  async listTranscriptSteps(input: {
    actorUserId: string
    runId: string
    workflowRunId: string
    cursor: string | null
  }): Promise<HarnessTranscriptPage> {
    const page = await convex.query<HarnessTranscriptPage>('harness/runs:listTranscriptSteps', {
      actorUserId: input.actorUserId,
      runId: input.runId,
      workflowRunId: input.workflowRunId,
      paginationOpts: { cursor: input.cursor, numItems: 25 },
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!page) throw new Error('Harness transcript read returned no page.')
    return page
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
    identityLinkId?: string; slackUserId?: string
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
    input: { actorUserId: string; runId: string; evidenceId?: string; cursor?: string; limit?: number },
  ): Promise<HarnessEvidence | null | { observations: Array<Pick<HarnessEvidence, 'id' | 'source' | 'verdict' | 'createdAt'>>; nextCursor: string | null }> {
    return await convex.query('harness/runs:readEvidence', {
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
