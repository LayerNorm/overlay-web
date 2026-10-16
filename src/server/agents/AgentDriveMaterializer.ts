import 'server-only'

import { createHash } from 'node:crypto'
import type { AgentDriveCandidate } from '@/shared/agents/agent-drive-manifest'

export type AgentDriveManifestEntry = {
  fileId: string; path: string; updatedAt: number
} & (
  | { kind: 'folder' }
  | { kind: 'file'; hydration: 'ready'; sizeBytes: number; sha256: string }
  | { kind: 'file'; hydration: 'deferred'; sizeBytes: number; reason: 'file_limit' | 'cache_limit' }
)
type CandidateSource = NonNullable<AgentDriveCandidate['source']>
export type AgentDriveSourceReader = {
  /** The underlying object size, not an extracted-text prefix length or host declaration. */
  size(source: Exclude<CandidateSource, { kind: 'inline' }>): Promise<number>
  /** Must bound its own network read; returning a truncated buffer is not permitted. */
  read(source: Exclude<CandidateSource, { kind: 'inline' }>, maximumBytes: number): Promise<Uint8Array>
}
export type AgentDriveMaterializerLimits = { fileBytes: number; totalBytes: number; entries: number }
const DEFAULT_LIMITS: AgentDriveMaterializerLimits = { fileBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, entries: 10000 }

/** Materializes only previously authorized candidates. This class grants no scope and issues no URLs. */
export class AgentDriveMaterializer {
  constructor(private readonly reader: AgentDriveSourceReader, private readonly limits = DEFAULT_LIMITS) {
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw Error('DRIVE_LIMIT_INVALID')
  }

  async read(candidate: AgentDriveCandidate, expected?: { sizeBytes: number; sha256: string }): Promise<Uint8Array> {
    if (candidate.kind !== 'file' || !candidate.source) throw Error('DRIVE_FILE_UNAVAILABLE')
    const source = candidate.source
    let bytes: Uint8Array | undefined
    let size: number
    if (source.kind === 'inline') { bytes = new TextEncoder().encode(source.text); size = bytes.byteLength }
    else size = await this.reader.size(source)
    this.assertSize(size)
    if (size > this.limits.fileBytes) throw Error('DRIVE_FILE_TOO_LARGE')
    if (source.kind !== 'inline') bytes = Uint8Array.from(await this.reader.read(source, this.limits.fileBytes))
    if (!bytes) throw Error('DRIVE_FILE_UNAVAILABLE')
    if (bytes.byteLength !== size || bytes.byteLength > this.limits.fileBytes) throw Error('DRIVE_SOURCE_CHANGED')
    if (expected && (expected.sizeBytes !== bytes.byteLength || expected.sha256 !== this.hash(bytes))) throw Error('DRIVE_SOURCE_CHANGED')
    return Uint8Array.from(bytes)
  }

  async manifest(candidates: AgentDriveCandidate[]): Promise<AgentDriveManifestEntry[]> {
    if (candidates.length > this.limits.entries) throw Error('DRIVE_TOO_MANY_ENTRIES')
    const entries: AgentDriveManifestEntry[] = []
    let hydratedBytes = 0
    for (const candidate of candidates) {
      const identity = { fileId: candidate.fileId, path: candidate.path, updatedAt: candidate.updatedAt }
      if (candidate.kind === 'folder') { entries.push({ ...identity, kind: 'folder' }); continue }
      const source = candidate.source
      if (!source) throw Error('DRIVE_FILE_UNAVAILABLE')
      const size = source.kind === 'inline' ? new TextEncoder().encode(source.text).byteLength : await this.reader.size(source)
      this.assertSize(size)
      const reason = size > this.limits.fileBytes ? 'file_limit' : hydratedBytes + size > this.limits.totalBytes ? 'cache_limit' : undefined
      if (reason) {
        entries.push({ ...identity, kind: 'file', hydration: 'deferred', sizeBytes: size, reason })
        continue
      }
      const bytes = await this.read(candidate)
      // Recheck the budget using the actual read, including a source that changed since size inspection.
      if (bytes.byteLength !== size || hydratedBytes + bytes.byteLength > this.limits.totalBytes) throw Error('DRIVE_SOURCE_CHANGED')
      hydratedBytes += bytes.byteLength
      entries.push({ ...identity, kind: 'file', hydration: 'ready', sizeBytes: bytes.byteLength, sha256: this.hash(bytes) })
    }
    return entries
  }

  private assertSize(size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw Error('DRIVE_INVALID_SOURCE_SIZE')
  }
  private hash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
}
