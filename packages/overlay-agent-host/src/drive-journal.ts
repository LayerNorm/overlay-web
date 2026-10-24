import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod/v3'
import { driveCredentialsResponseSchema, driveUploadBodySchema, driveMetadataBodySchema,
  driveContentResultSchema, driveMetadataResultSchema, type DriveUploadRequest, type DriveMetadataRequest,
  type DriveContentResult, type DriveMetadataResult } from '@layernorm/overlay-agent-bridge-protocol'
import {driveRecoveryResultSchema, type DriveRecoveryResult} from '@layernorm/overlay-agent-bridge-protocol'

const id = z.string().min(1).max(200)
export const driveJournalContextSchema = z.object({ environmentId: id, runId: id, sessionId: id,
  scope: driveCredentialsResponseSchema.shape.scope,
  execution: z.object({ attemptId: id, generation: z.number().int().positive() }).strict().optional(),
}).strict()
export type DriveJournalContext = z.infer<typeof driveJournalContextSchema>
const uploadId = z.string().uuid()
const contentPhase = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queued') }).strict(),
  z.object({ kind: z.literal('intent'), uploadId }).strict(),
  z.object({ kind: z.literal('uploaded'), uploadId }).strict(),
  z.object({ kind: z.literal('committing'), uploadId }).strict(),
  z.object({ kind: z.literal('committed'), uploadId, result: driveContentResultSchema }).strict(),
])
const contentRecord = z.object({ kind: z.literal('content'), request: driveUploadBodySchema, phase: contentPhase }).strict()
const metadataRecord = z.object({ kind: z.literal('metadata'), request: driveMetadataBodySchema,
  phase: z.discriminatedUnion('kind', [z.object({ kind: z.literal('queued') }).strict(),
    z.object({ kind: z.literal('committing') }).strict(),
    z.object({ kind: z.literal('committed'), result: driveMetadataResultSchema }).strict()]),
}).strict()
const recordSchema = z.discriminatedUnion('kind', [contentRecord, metadataRecord])
export type DriveJournalRecord = z.infer<typeof recordSchema>
type ContentRecord = z.infer<typeof contentRecord>
type MetadataRecord = z.infer<typeof metadataRecord>
const rowSchema = z.object({ authority: z.string(), record_json: z.string() })

/** Private durable intent/payload journal. It stores no tokens, signed URLs or object-store keys. */
export class SqliteDriveJournal {
  private readonly database: DatabaseSync
  private readonly authority: string
  private readonly context: DriveJournalContext

  constructor(path: string, context: DriveJournalContext) {
    const parsed = checked(driveJournalContextSchema, context)
    this.context = parsed
    this.authority = JSON.stringify(parsed)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('DRIVE_UNSAFE_JOURNAL')
    } else closeSync(openSync(path, 'wx', 0o600))
    this.database = new DatabaseSync(path)
    chmodSync(path, 0o600)
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS drive_scope (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drive_writes (request_id TEXT PRIMARY KEY, authority TEXT NOT NULL,
        record_json TEXT NOT NULL, payload BLOB, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS drive_recovery_outcomes (request_id TEXT PRIMARY KEY, authority TEXT NOT NULL, outcome_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS drive_writes_authority ON drive_writes(authority);`)
    try {
      this.transaction(() => {
        const scope = JSON.stringify([parsed.environmentId, parsed.scope])
        const prior = this.database.prepare('SELECT value FROM drive_scope WHERE id=1').get()
        if (prior && checked(z.object({ value: z.string() }), prior).value !== scope) throw Error('DRIVE_JOURNAL_SCOPE_CHANGED')
        this.database.prepare('INSERT OR IGNORE INTO drive_scope(id,value) VALUES(1,?)').run(scope)
        const foreign = this.database.prepare(`SELECT request_id FROM drive_writes w WHERE authority<>?
          AND json_extract(record_json,'$.phase.kind')<>'committed' AND NOT EXISTS
          (SELECT 1 FROM drive_recovery_outcomes r WHERE r.request_id=w.request_id AND r.authority=w.authority
            AND json_extract(r.outcome_json,'$.resolution.state')='uncommitted') LIMIT 1`).get(this.authority)
        if (foreign) throw Error('DRIVE_UNSAVED_OTHER_EXECUTION')
      })
    } catch (error) { this.database.close(); throw error }
  }

  close() { this.database.close() }

  prepareContent(input: DriveUploadRequest, bytes: Uint8Array): ContentRecord {
    const request = checked(driveUploadBodySchema, input)
    if (bytes.byteLength !== request.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== request.sha256) throw Error('DRIVE_JOURNAL_CONTENT_CHANGED')
    return this.transaction(() => {
      const prior = this.find(request.requestId)
      this.requireWritableRequest(request.requestId)
      if (prior) {
        if (prior.kind !== 'content' || JSON.stringify(prior.request) !== JSON.stringify(request)) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
        return prior
      }
      this.limit(bytes.byteLength)
      const record: ContentRecord = { kind: 'content', request, phase: { kind: 'queued' } }
      this.insert(record, bytes)
      return record
    })
  }

  prepareMetadata(input: DriveMetadataRequest): MetadataRecord {
    const request = checked(driveMetadataBodySchema, input)
    return this.transaction(() => {
      const prior = this.find(request.requestId)
      this.requireWritableRequest(request.requestId)
      if (prior) {
        if (prior.kind !== 'metadata' || JSON.stringify(prior.request) !== JSON.stringify(request)) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
        return prior
      }
      this.limit(0)
      const record: MetadataRecord = { kind: 'metadata', request, phase: { kind: 'queued' } }
      this.insert(record, null)
      return record
    })
  }

  pending(): DriveJournalRecord[] {
    return this.database.prepare(`SELECT authority,record_json FROM drive_writes w WHERE authority=?
      AND json_extract(record_json,'$.phase.kind')<>'committed' AND NOT EXISTS
      (SELECT 1 FROM drive_recovery_outcomes r WHERE r.request_id=w.request_id AND r.authority=w.authority
        AND json_extract(r.outcome_json,'$.resolution.state')='uncommitted') ORDER BY rowid LIMIT 10000`)
      .all(this.authority).map(row => this.decode(row))
  }

  find(requestId: string): DriveJournalRecord | undefined {
    const row = this.database.prepare('SELECT authority,record_json FROM drive_writes WHERE request_id=?').get(requestId)
    return row ? this.decode(row) : undefined
  }

  /** Only after the sync baseline and its cleared pending effect are durable. */
  forgetCompleted(requestId: string): void {
    const record = this.find(requestId)
    if (!record || record.phase.kind !== 'committed') throw Error('DRIVE_WRITE_UNSAVED')
    this.transaction(() => {
      this.database.prepare('DELETE FROM drive_recovery_outcomes WHERE request_id=? AND authority=?').run(requestId, this.authority)
      this.database.prepare('DELETE FROM drive_writes WHERE request_id=? AND authority=?').run(requestId, this.authority)
    })
  }

  recoveryOutcome(requestId: string): DriveRecoveryResult | undefined {
    const row = this.database.prepare('SELECT authority,outcome_json FROM drive_recovery_outcomes WHERE request_id=?').get(requestId)
    if (!row) return undefined
    const parsed = checked(z.object({authority: z.string(), outcome_json: z.string()}), row)
    if (parsed.authority !== this.authority) throw Error('DRIVE_JOURNAL_EXECUTION_CHANGED')
    const result = checked(driveRecoveryResultSchema, JSON.parse(parsed.outcome_json))
    if (result.requestId !== requestId || result.previousExecution.attemptId !== this.context.execution?.attemptId
      || result.previousExecution.generation !== this.context.execution?.generation) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
    return result
  }

  /** Persist a verified read-only outcome before repairing the baseline. Uncommitted bytes remain archived. */
  settleRecovery(requestId: string, input: DriveRecoveryResult): void {
    const outcome = checked(driveRecoveryResultSchema, input)
    if (outcome.requestId !== requestId || outcome.previousExecution.attemptId !== this.context.execution?.attemptId
      || outcome.previousExecution.generation !== this.context.execution?.generation) throw Error('DRIVE_JOURNAL_EXECUTION_CHANGED')
    this.transaction(() => {
      const prior = this.recoveryOutcome(requestId)
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(outcome)) throw Error('DRIVE_JOURNAL_RECEIPT_CHANGED')
        return
      }
      const record = this.find(requestId)
      if (!record) throw Error('DRIVE_JOURNAL_UNAVAILABLE')
      const resolution = outcome.resolution
      if (resolution.state === 'uncommitted') {
        if (record.phase.kind === 'committed') throw Error('DRIVE_JOURNAL_RECEIPT_CHANGED')
      } else if (resolution.state === 'content_committed' && record.kind === 'content') {
        this.save(confirmedContent(record, resolution.uploadId, resolution.result))
        this.database.prepare('UPDATE drive_writes SET payload=NULL WHERE request_id=? AND authority=?').run(requestId, this.authority)
      } else if (resolution.state === 'metadata_committed' && record.kind === 'metadata') {
        if (record.phase.kind === 'committed' && JSON.stringify(record.phase.result) !== JSON.stringify(resolution.result)) throw Error('DRIVE_JOURNAL_RECEIPT_CHANGED')
        this.save({...record, phase: {kind: 'committed', result: resolution.result}})
      } else throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
      this.database.prepare('INSERT INTO drive_recovery_outcomes(request_id,authority,outcome_json) VALUES(?,?,?)')
        .run(requestId, this.authority, JSON.stringify(outcome))
    })
  }

  content(requestId: string): Uint8Array {
    const record = this.find(requestId)
    if (!record || record.kind !== 'content' || record.phase.kind === 'committed') throw Error('DRIVE_JOURNAL_CONTENT_UNAVAILABLE')
    const row = this.database.prepare('SELECT payload FROM drive_writes WHERE request_id=?').get(requestId)
    const { payload } = checked(z.object({ payload: z.instanceof(Uint8Array) }), row)
    if (payload.byteLength !== record.request.sizeBytes || createHash('sha256').update(payload).digest('hex') !== record.request.sha256) throw Error('DRIVE_JOURNAL_CONTENT_CHANGED')
    return Uint8Array.from(payload)
  }

  advanceContent(requestId: string, next: 'intent' | 'uploaded' | 'committing', value: string): ContentRecord {
    this.requireWritableRequest(requestId)
    const nextUploadId = checked(uploadId, value)
    return this.transaction(() => {
      const record = this.find(requestId)
      if (!record || record.kind !== 'content') throw Error('DRIVE_JOURNAL_UNAVAILABLE')
      const phase = record.phase
      if (phase.kind !== 'queued' && phase.uploadId !== nextUploadId) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
      const order = ['queued', 'intent', 'uploaded', 'committing', 'committed']
      const current = order.indexOf(phase.kind), target = order.indexOf(next)
      if (target <= current) return record
      if (target !== current + 1) throw Error('DRIVE_JOURNAL_INVALID_TRANSITION')
      const updated: ContentRecord = { ...record, phase: { kind: next, uploadId: nextUploadId } }
      this.save(updated)
      return updated
    })
  }

  commitContent(requestId: string, value: string, input: DriveContentResult): ContentRecord {
    this.requireWritableRequest(requestId)
    const result = checked(driveContentResultSchema, input), confirmedUploadId = checked(uploadId, value)
    return this.transaction(() => {
      const record = this.find(requestId)
      if (!record || record.kind !== 'content') throw Error('DRIVE_JOURNAL_UNAVAILABLE')
      const updated = confirmedContent(record, confirmedUploadId, result)
      this.save(updated)
      this.database.prepare('UPDATE drive_writes SET payload=NULL WHERE request_id=?').run(requestId)
      return updated
    })
  }

  advanceMetadata(requestId: string, input?: DriveMetadataResult): MetadataRecord {
    this.requireWritableRequest(requestId)
    return this.transaction(() => {
      const record = this.find(requestId)
      if (!record || record.kind !== 'metadata') throw Error('DRIVE_JOURNAL_UNAVAILABLE')
      if (record.phase.kind === 'committed') {
        if (input && JSON.stringify(record.phase.result) !== JSON.stringify(checked(driveMetadataResultSchema, input))) throw Error('DRIVE_JOURNAL_RECEIPT_CHANGED')
        return record
      }
      const updated: MetadataRecord = { ...record, phase: input
        ? { kind: 'committed', result: checked(driveMetadataResultSchema, input) } : { kind: 'committing' } }
      this.save(updated)
      return updated
    })
  }

  private requireWritableRequest(requestId: string) {
    if (this.recoveryOutcome(requestId)?.resolution.state === 'uncommitted') throw Error('DRIVE_JOURNAL_REQUEST_FENCED')
  }

  private decode(input: unknown): DriveJournalRecord {
    const row = checked(rowSchema, input)
    if (row.authority !== this.authority) throw Error('DRIVE_JOURNAL_EXECUTION_CHANGED')
    return checked(recordSchema, JSON.parse(row.record_json))
  }
  private insert(record: DriveJournalRecord, bytes: Uint8Array | null) {
    this.database.prepare('INSERT INTO drive_writes(request_id,authority,record_json,payload,updated_at) VALUES(?,?,?,?,?)')
      .run(record.request.requestId, this.authority, JSON.stringify(record), bytes, Date.now())
  }
  private save(record: DriveJournalRecord) {
    this.database.prepare('UPDATE drive_writes SET record_json=?,updated_at=? WHERE request_id=? AND authority=?')
      .run(JSON.stringify(record), Date.now(), record.request.requestId, this.authority)
  }
  private limit(bytes: number) {
    const count = checked(z.object({ count: z.number(), bytes: z.number() }), this.database.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(payload)),0) AS bytes FROM drive_writes').get())
    if (count.count >= 10000 || count.bytes + bytes > 256 * 1024 * 1024) throw Error('DRIVE_JOURNAL_LIMIT')
  }
  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.database.exec('COMMIT'); return result }
    catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}

function confirmedContent(record: ContentRecord, uploadId: string, result: DriveContentResult): ContentRecord {
  if (result.sha256 !== record.request.sha256 || result.sizeBytes !== record.request.sizeBytes
    || (record.phase.kind !== 'queued' && record.phase.uploadId !== uploadId)) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
  if (record.phase.kind === 'committed' && JSON.stringify(record.phase.result) !== JSON.stringify(result)) throw Error('DRIVE_JOURNAL_RECEIPT_CHANGED')
  return {...record, phase: {kind: 'committed', uploadId, result}}
}

function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw Error('DRIVE_JOURNAL_INVALID')
  return parsed.data
}
