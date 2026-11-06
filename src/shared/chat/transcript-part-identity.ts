import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'

export function withTranscriptPartIds(
  runId: string,
  receiptId: string,
  persistence: HarnessTranscriptPersistence,
): HarnessTranscriptPersistence {
  return {
    ...persistence,
    parts: persistence.parts.map((part, index) => typeof part.id === 'string' && part.id
      ? part
      : { ...part, id: JSON.stringify(typeof part.storageOmittedParts === 'number'
        ? [runId, 'omitted'] : [runId, receiptId, index]) }),
  }
}
