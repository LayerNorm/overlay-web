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
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const sized = await Promise.all(candidates.slice(offset, offset + 4).map(async candidate => {
        if (candidate.kind === 'folder') return {candidate, size: 0}
        const source = candidate.source
        if (!source) throw Error('DRIVE_FILE_UNAVAILABLE')
        const size = source.kind === 'inline' ? new TextEncoder().encode(source.text).byteLength : await this.reader.size(source)
        this.assertSize(size)
        return {candidate, size}
      }))
      // Reserve bytes in manifest order before concurrent reads can finish in another order.
      const planned = sized.map(({candidate, size}) => {
        const reason = size > this.limits.fileBytes ? 'file_limit' as const
          : hydratedBytes + size > this.limits.totalBytes ? 'cache_limit' as const : undefined
        if (candidate.kind === 'file' && !reason) hydratedBytes += size
        return {candidate, size, reason}
      })
      entries.push(...await Promise.all(planned.map(({candidate, size, reason}) => this.manifestEntry(candidate, size, reason))))
    }
    return entries
  }

  private async manifestEntry(candidate: AgentDriveCandidate, size: number,
    reason: 'file_limit' | 'cache_limit' | undefined): Promise<AgentDriveManifestEntry> {
    const identity = {fileId: candidate.fileId, path: candidate.path, updatedAt: candidate.updatedAt}
    if (candidate.kind === 'folder') return {...identity, kind: 'folder'}
    if (reason) return {...identity, kind: 'file', hydration: 'deferred', sizeBytes: size, reason}
    const bytes = await this.read(candidate)
    if (bytes.byteLength !== size) throw Error('DRIVE_SOURCE_CHANGED')
    return {...identity, kind: 'file', hydration: 'ready', sizeBytes: bytes.byteLength, sha256: this.hash(bytes)}
  }

  private assertSize(size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw Error('DRIVE_INVALID_SOURCE_SIZE')
  }
  private hash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
}
