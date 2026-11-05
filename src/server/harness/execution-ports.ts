import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import { admitHarnessRequestUsage } from './request-usage-step'
import { createHarnessStatePorts } from './state-ports'
import { waitForHarnessModelResources } from './resource-boundary'
import type { HarnessExecutionReference } from './state-steps'
import { readHarnessArtifactData, readHarnessArtifactMetadata } from './artifact-steps'
import { readHarnessArtifactMedia, readHarnessArtifactText } from './artifact-context'

export type HarnessSurfacePorts = Pick<HarnessExecutionPorts,
  'recordToolResult' | 'delegate' | 'readChild' | 'waitForChildren' | 'waitForInput' | 'waitForApproval'
  | 'waitForFunding' | 'checkFunding' | 'fileAnalysisEnabled' | 'readFileCoverage'>
  & Partial<Pick<HarnessExecutionPorts, 'continueExecution'>>

export function createHarnessExecutionPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  authorize: (toolName?: string) => Promise<void>
  model: Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure'>
  surface: HarnessSurfacePorts
  // Set when the surface workflow already claimed, authorized and admitted the
  // run in its own steps. The runner's first read then uses this post-claim
  // snapshot and its claim adds no durable steps.
  admitted?: HarnessSnapshot
}): HarnessExecutionPorts {
  const state = createHarnessStatePorts(input.reference)
  let admitted = input.admitted
  return {
    ...input.surface,
    ...state,
    ...input.model,
    read: async () => {
      if (!admitted) return state.read()
      const snapshot = admitted
      admitted = undefined
      return snapshot
    },
    renewLease: () => input.authorize(),
    continueExecution: input.surface.continueExecution ?? (async () => {
      throw new Error('HARNESS_CONTINUATION_NOT_CONFIGURED')
    }),
    waitForResources: async requiredCostMicros => {
      await input.authorize()
      return waitForHarnessModelResources(input.reference, requiredCostMicros, state.read)
    },
    waitForChildren: async childRunIds => {
      await input.authorize()
      return input.surface.waitForChildren(childRunIds)
    },
    waitForInput: async current => {
      await input.authorize()
      return input.surface.waitForInput(current)
    },
    waitForApproval: async requests => {
      await input.authorize()
      return input.surface.waitForApproval(requests)
    },
    claim: async () => {
      if (input.admitted) return true
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
        artifactId: metadata.artifactId,
        toolName: metadata.toolName,
        toolCallId: metadata.toolCallId,
        mediaPartCount: metadata.mediaPartCount,
        ...(resource ? { resource } : {}),
      }
      if (request.mediaPart !== undefined) {
        return {
          kind: 'media' as const,
          ...readHarnessArtifactMedia(bytes, request.mediaPart),
          metadata: { ...artifactMetadata, mediaPart: request.mediaPart },
        }
      }
      return { kind: 'text' as const, text: readHarnessArtifactText(bytes, request.start ?? 0,
        request.end ?? 16_000), metadata: artifactMetadata }
    },
  }
}
