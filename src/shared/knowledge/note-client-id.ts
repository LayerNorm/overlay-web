export interface NoteClientIdCandidate {
  _id: string
  clientId?: string
  name: string
  type: 'file' | 'folder'
  kind?: 'folder' | 'note' | 'upload' | 'output'
  content?: string
  textContent?: string
  contentHash?: string
  updatedAt: number
  deletedAt?: number
}

function normalizedTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function noteText(candidate: NoteClientIdCandidate): string {
  return candidate.textContent ?? candidate.content ?? ''
}

/**
 * Resolves an idempotent desktop note create. Exact client ids always win.
 * For records created before files retained clientId, one empty same-title
 * note may be claimed and populated; ambiguous or populated notes stay distinct.
 */
export function selectNoteClientIdCandidate<T extends NoteClientIdCandidate>(
  candidates: readonly T[],
  input: { clientId: string; title: string; contentHash?: string }
): T | null {
  const exactMatches = candidates
    .filter((candidate) => candidate.clientId === input.clientId && candidate.kind === 'note')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (exactMatches.length) return exactMatches[0] ?? null

  const title = normalizedTitle(input.title)
  const legacyMatches = candidates.filter((candidate) => {
    if (candidate.deletedAt || candidate.clientId || candidate.kind !== 'note') return false
    if (normalizedTitle(candidate.name) !== title) return false
    if (!noteText(candidate).trim()) return true
    return Boolean(input.contentHash && candidate.contentHash === input.contentHash)
  })

  return legacyMatches.length === 1 ? (legacyMatches[0] ?? null) : null
}
