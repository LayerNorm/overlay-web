import { compactAssistantPersistenceForConvex, isAssistantStorageOmission } from '@/shared/chat/persist-assistant-turn'
import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'

const MAX_SNAPSHOT_BYTES = 240 * 1024

/** The full public payload lives in file storage; this is only the bounded delivery cache. */
export function compactTranscriptSnapshot(input: HarnessTranscriptPersistence): HarnessTranscriptPersistence {
  const snapshot = compactAssistantPersistenceForConvex(input)
  let omitted = snapshot.parts.reduce((sum, part) => sum + (isAssistantStorageOmission(part)
    ? Number(part.storageOmittedParts) || 0 : 0), 0)
  while (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
    if (snapshot.content.length > 16_000) {
      snapshot.content = `[Earlier response text stored in full trace]\n\n${snapshot.content.slice(-Math.floor(snapshot.content.length / 2))}`
      continue
    }
    const candidates = snapshot.parts.filter(part => !isAssistantStorageOmission(part))
    const answer = candidates.findLast(part => part.type === 'text' && typeof part.text === 'string')
    const removable = candidates.findIndex(part => part !== answer)
    if (removable >= 0) {
      candidates.splice(removable, 1)
      omitted++
    } else if (answer && typeof answer.text === 'string' && answer.text.length > 1_024) {
      candidates[candidates.indexOf(answer)] = {
        ...answer, text: `[Earlier text stored in full trace]\n\n${answer.text.slice(-Math.floor(answer.text.length / 2))}`,
      }
    } else {
      omitted += candidates.length
      candidates.length = 0
    }
    snapshot.parts = [
      ...(omitted ? [{ type: 'text', text: `[${omitted} additional assistant parts omitted for storage]`, storageOmittedParts: omitted }] : []),
      ...candidates,
    ]
  }
  return snapshot
}
