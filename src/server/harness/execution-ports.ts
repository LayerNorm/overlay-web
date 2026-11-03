import type { HarnessExecutionPorts } from './ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-ports'
import { waitForHarnessModelResources } from './resource-boundary'
import type { HarnessExecutionReference } from './state-steps'
import { readHarnessArtifactData, readHarnessArtifactMetadata } from './artifact-steps'
import { readHarnessArtifactMedia, readHarnessArtifactText } from './artifact-context'

export type HarnessSurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval'>

export function createHarnessExecutionPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  authorize: (toolName?: string) => Promise<void>
  model: Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure' | 'verifyFinalAnswer'>
  surface: HarnessSurfacePorts
}): HarnessExecutionPorts {
  const state = createHarnessStatePorts(input.reference)
  return {
    ...input.surface,
    ...state,
    ...input.model,
    waitForResources: requiredCostMicros => waitForHarnessModelResources(input.reference, requiredCostMicros, state.read),
    claim: async () => {
      if (!await state.claim()) return false
      await input.authorize()
      await admitHarnessRequestUsage(input.reference, input.modelId)
      return true
    },
    authorizeTool: toolName => input.authorize(toolName),
    readArtifact: async request => {
      const metadata = await readHarnessArtifactMetadata(input.reference, request.artifactId)
      if (!metadata) throw new Error('Harness artifact is not available to this run.')
      await input.authorize(metadata.toolName)
      const bytes = await readHarnessArtifactData(input.reference, request.artifactId)
      if (!bytes) throw new Error('Harness artifact content is unavailable.')
      const resource = metadata.resource
      const artifactMetadata = {
        toolName: metadata.toolName, toolCallId: metadata.toolCallId,
        ...(resource ? { resource } : {}),
      }
      if (request.mediaPart !== undefined) {
        return { kind: 'media' as const, ...readHarnessArtifactMedia(bytes, request.mediaPart), metadata: artifactMetadata }
      }
      return { kind: 'text' as const, text: readHarnessArtifactText(bytes, request.start ?? 0,
        request.end ?? 16_000), metadata: artifactMetadata }
    },
  }
}
