import 'server-only'

import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import { deploymentEnv } from '@/server/env/deployment-env'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { HarnessArtifactMetadata } from './artifact-context'
import type { AssignmentChildHandle, AssignmentResultView } from '@/shared/agents/assignment-result'
import type { AssignmentCancellationRoot, NativeRecoveryRequest, NativeRecoveryWork } from '@/shared/agents/assignment-recovery'

export function artifactClient() {
  const { url, invalid } = resolveConvexUrl(deploymentEnv())
  if (!url || invalid) throw new Error('Harness artifact storage is unavailable.')
  return new ConvexHttpClient(url, { logger: false, skipConvexDeploymentUrlCheck: true })
}

export class ConvexHarnessAssignments {
  protected get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getNativeRecoveryWork(input: NativeRecoveryRequest) {
    return await convex.mutation<NativeRecoveryWork | null>('collaboration/assignmentRecovery:work', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async acknowledgeNativeRecovery(input: NativeRecoveryRequest) {
    await convex.mutation('collaboration/assignmentRecovery:acknowledge', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async acquireNativeTurn(input: { actorUserId: string; deliveryAgentRunId: string; memoryEnabled?: boolean }) {
    return await convex.mutation<boolean>('collaboration/nativeTurnQueue:acquire', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async readAssignmentIssues(input: { actorUserId: string; parentRunId: string }) {
    const issues = await convex.query<string[]>('collaboration/assignmentCoordination:issues', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
    if (!issues) throw new Error('Assignment obligations are unavailable.')
    return issues
  }

  async readAssignmentChild(input: { actorUserId: string; workspaceId: string; parentRunId: string; assignmentId: string }) {
    return await convex.query<AssignmentChildHandle | null>('collaboration/assignmentResults:currentChild', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async resolveAssignment(input: { actorUserId: string; workspaceId: string; parentRunId: string; workflowRunId: string;
    executionGeneration: number; assignmentId: string; attemptId: string; action: 'accept' | 'exclude' | 'cancel'; reason?: string }) {
    const resolution = await convex.mutation<{ assignmentId: string; attemptId: string; disposition: string; reason?: string; workflows: string[]; cancellationRoot?: AssignmentCancellationRoot }>(
      'collaboration/assignmentCoordination:resolve', { ...input, serverSecret: this.serverSecret }, { throwOnError: true })
    if (!resolution) throw new Error('Assignment resolution is unavailable.')
    return resolution
  }

  async readAssignmentResult(args: { actorUserId: string; workspaceId: string; parentRunId?: string; childRunId?: string; conversationId?: string; turnId?: string }) {
    return await convex.query<AssignmentResultView | null>('collaboration/assignmentResults:read', { ...args, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async settleAssignmentResult(childRunId: string) {
    await convex.mutation('collaboration/assignmentResults:settle', { childRunId, serverSecret: this.serverSecret }, { throwOnError: true })
  }

  async readSettledAssignmentArtifact(input: { actorUserId: string; workspaceId: string; attemptId: string; artifactId: string }) {
    const identity = { ...input, serverSecret: this.serverSecret }
    const metadata = await convex.query<HarnessArtifactMetadata | null>('collaboration/assignmentResults:settledArtifact', identity, { throwOnError: true })
    if (!metadata) return null
    const client = artifactClient()
    const bytes = new Uint8Array(metadata.byteSize)
    for (let offset = 0; offset < metadata.byteSize; offset += 256 * 1024) {
      const chunk = await client.action(api.harness.artifacts.readSettledResultChunk, { ...identity, offset,
        length: Math.min(256 * 1024, metadata.byteSize - offset) })
      if (!chunk) throw new Error('Harness artifact content is unavailable.')
      bytes.set(new Uint8Array(chunk), offset)
    }
    return bytes
  }
}
