import type { PartialBlock } from '@blocknote/core'

export type NoteDocFormat = 'markdown' | 'blocknote'

export const NOTE_DOC_VERSION = 1

export interface NoteDocEnvelope {
  v: number
  blocks: PartialBlock[]
}

export function stringifyNoteDoc(blocks: PartialBlock[]): string {
  return JSON.stringify({ v: NOTE_DOC_VERSION, blocks } satisfies NoteDocEnvelope)
}

/**
 * Parses a stored `docJson` envelope into blocks. Returns null when the value is
 * absent or malformed so callers can fall back to the markdown `content`.
 */
export function parseNoteDocJson(
  docJson: string | null | undefined,
): PartialBlock[] | null {
  if (!docJson) return null
  try {
    const raw = JSON.parse(docJson) as Partial<NoteDocEnvelope>
    if (!raw || !Array.isArray(raw.blocks)) return null
    return raw.blocks
  } catch {
    return null
  }
}
