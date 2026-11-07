import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'

export function transcriptPartIdentity(
  runId: string,
  receiptId: string,
  index: number | string,
  executionGeneration?: number,
): string {
  return JSON.stringify(executionGeneration === undefined
    ? [runId, receiptId, index]
    : [runId, executionGeneration, receiptId, index])
}

export function withTranscriptPartIds(
  runId: string,
  receiptId: string,
  persistence: HarnessTranscriptPersistence,
): HarnessTranscriptPersistence {
  return {
    ...persistence,
    parts: persistence.parts.map((part, index) => typeof part.id === 'string' && part.id
      ? part
      : { ...part, id: typeof part.storageOmittedParts === 'number'
        ? JSON.stringify([runId, 'omitted'])
        : transcriptPartIdentity(runId, receiptId, index) }),
  }
}
