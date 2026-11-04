import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { externalizeOlderHarnessToolResults, parseHarnessArtifactOutput, serializeHarnessArtifactOutput, shouldExternalizeHarnessToolOutput } from './artifact-context'
import { identifyHarnessArtifact, readHarnessArtifactMetadata, storeHarnessArtifact } from './artifact-steps'
import { HarnessYield } from './model-recovery'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { findResourceIdentity } from './tool-evidence'

export async function prepareHarnessArtifactPrompt(input: {
  reference: HarnessExecutionReference
  state: HarnessSnapshot
  messages: LanguageModelV4Prompt
  receiptId: string
}): Promise<LanguageModelV4Prompt> {
  try {
    const artifacts = new Map()
    const readArtifactCalls = new Map<string, string>()
    for (const message of input.messages) {
      if (message.role !== 'assistant') continue
      for (const part of message.content) {
        if (part.type === 'tool-call' && part.toolName === 'harness_read_artifact'
          && part.input && typeof part.input === 'object'
          && typeof (part.input as Record<string, unknown>).artifactId === 'string') {
          readArtifactCalls.set(part.toolCallId, (part.input as Record<string, string>).artifactId)
        }
      }
    }
    for (const message of input.messages) {
      if (message.role !== 'tool') continue
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue
        if (part.toolName === 'harness_read_artifact') {
          const artifactId = readArtifactCalls.get(part.toolCallId)
          if (artifactId) {
            const metadata = await readHarnessArtifactMetadata(input.reference, artifactId)
            if (!metadata) throw new Error('The original Harness artifact is no longer available.')
            artifacts.set(part.toolCallId, metadata)
          }
          continue
        }
        if (!shouldExternalizeHarnessToolOutput(part.output)) continue
        const data = serializeHarnessArtifactOutput(part.output)
        const { digest, artifactId } = await identifyHarnessArtifact({
          data, runId: input.reference.runId, toolCallId: part.toolCallId,
        })
        const resource = input.state.evidence.find(item => item.id === `tool:${part.toolCallId}`)?.resource
          ?? findResourceIdentity(part.output)
        const artifact = await storeHarnessArtifact(input.reference, {
          artifactId,
          toolCallId: part.toolCallId, toolName: part.toolName, digest, data,
          mediaPartCount: parseHarnessArtifactOutput(data).binaryParts.length,
          ...(resource ? { resource } : {}),
        })
        artifacts.set(part.toolCallId, artifact)
      }
    }
    return externalizeOlderHarnessToolResults(input.messages, artifacts)
  } catch (_error) {
    const current = await readHarnessState(input.reference)
    if (current.status === 'running' && !current.modelReservation) {
      await applyHarnessOperation(input.reference, `artifact-unavailable:${input.receiptId}`, {
        type: 'block',
        blocker: { kind: 'stuck', question: 'Large tool context could not be stored safely. The original conversation remains intact; resume after artifact storage is available.' },
      })
    }
    throw new HarnessYield()
  }
}
