import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessArtifactMetadata } from './artifact-context'

export async function storeHarnessArtifact(
  reference: HarnessExecutionReference,
  input: {
    artifactId: string
    toolCallId: string
    toolName: string
    digest: string
    data: Uint8Array
    mediaPartCount: number
    resource?: { id: string; revision?: string; operation?: string; page?: number }
  },
): Promise<HarnessArtifactMetadata> {
  'use step'
  return new ConvexHarnessRepository().storeContextArtifact({
    ...input, actorUserId: reference.actorUserId, runId: reference.runId, workflowRunId: reference.workflowRunId,
  })
}

export async function readHarnessArtifactMetadata(
  reference: HarnessExecutionReference,
  artifactId: string,
): Promise<HarnessArtifactMetadata | null> {
  'use step'
  return new ConvexHarnessRepository().getContextArtifactMetadata({
    actorUserId: reference.actorUserId, runId: reference.runId,
    workflowRunId: reference.workflowRunId, artifactId,
  })
}

export async function readHarnessArtifactData(
  reference: HarnessExecutionReference,
  artifactId: string,
): Promise<Uint8Array | null> {
  'use step'
  return new ConvexHarnessRepository().readContextArtifact({
    actorUserId: reference.actorUserId, runId: reference.runId,
    workflowRunId: reference.workflowRunId, artifactId,
  })
}
