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
import type { HarnessArtifactMetadata } from './artifact-context'
import type {
  HarnessConsumeResourceGrantInput, HarnessGrantResourcesInput, HarnessResourceConsumeResult,
  HarnessResourceGrantReceipt, HarnessResourcePauseInput, HarnessResourceRequestRecord,
  HarnessResourceRequestReference,
} from '@overlay/agent-runtime/harness-resource'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import { deploymentEnv } from '@/server/env/deployment-env'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { requireNativeThreadCompatibilityBackend } from '@/server/conversations/native-thread-compatibility-backend'

function artifactClient() {
  const { url, invalid } = resolveConvexUrl(deploymentEnv())
  if (!url || invalid) throw new Error('Harness artifact storage is unavailable.')
  return new ConvexHttpClient(url, { logger: false, skipConvexDeploymentUrlCheck: true })
}

export class ConvexHarnessRepository implements HarnessRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

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

  async readEvidence(
    input: { actorUserId: string; runId: string; evidenceId: string; cursor?: string; limit?: number },
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
