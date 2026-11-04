import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import { harnessArtifactDigest, harnessArtifactId, type HarnessArtifactMetadata } from './artifact-context'

export async function identifyHarnessArtifact(input: { data: Uint8Array; runId: string; toolCallId: string }) {
  'use step'
  if (!globalThis.crypto?.subtle) throw new Error('Harness artifact hashing is unavailable in this runtime.')
  const digest = await harnessArtifactDigest(input.data)
  return { digest, artifactId: await harnessArtifactId(input.runId, input.toolCallId, digest) }
}

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
