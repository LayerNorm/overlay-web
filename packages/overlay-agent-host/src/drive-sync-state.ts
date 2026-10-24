import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod/v3'
import { driveCredentialsResponseSchema, driveManifestEntrySchema, driveMetadataBodySchema, driveSavedEntrySchema,
  drivePathSegments, driveUploadBodySchema, portableDrivePathKey } from '@layernorm/overlay-agent-bridge-protocol'

const identity = z.object({ device: z.string(), inode: z.string(), birthtimeNs: z.string() }).strict()
const local = z.object({ path: z.string(), identity }).strict()
const baseline = z.object({ entry: driveManifestEntrySchema, local: local.nullable() }).strict()
export const driveSyncOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('content'), request: driveUploadBodySchema, target: local, priorFileId: z.string().optional() }).strict(),
  z.object({ kind: z.literal('metadata'), request: driveMetadataBodySchema, target: local }).strict(),
])
const common = { initialized: z.boolean(), baseline: z.array(baseline).max(10000),
  turn: z.object({ runId: z.string().min(1), saved: z.array(driveSavedEntrySchema).max(10000) }).strict().nullable() }
const snapshot = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('idle'), ...common }).strict(),
  z.object({ phase: z.literal('writing'), ...common, operation: driveSyncOperationSchema }).strict(),
  z.object({ phase: z.literal('hydrating'), ...common, entry: driveManifestEntrySchema, path: z.string(), prior: local.nullable() }).strict(),
])
export type DriveSyncSnapshot = z.infer<typeof snapshot>
export type DriveSyncOperation = z.infer<typeof driveSyncOperationSchema>
export type DriveBaseline = z.infer<typeof baseline>
export type DriveLocalReference = z.infer<typeof local>

/** Private baseline and one pending effect. The separate write journal owns immutable upload bytes. */
export class SqliteDriveSyncState {
  private readonly database: DatabaseSync

  constructor(path: string, cacheRoot: string, scope: z.infer<typeof driveCredentialsResponseSchema.shape.scope>) {
    const root = realpathSync(cacheRoot)
    requirePrivatePath(root, resolve(path))
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    requirePrivatePath(root, join(realpathSync(dirname(path)), basename(path)))
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('DRIVE_UNSAFE_SYNC_STATE')
    } else closeSync(openSync(path, 'wx', 0o600))
    this.database = new DatabaseSync(path)
    chmodSync(path, 0o600)
    try {
      this.database.exec(`PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS drive_sync (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, value TEXT NOT NULL);`)
      const expected = JSON.stringify([root, driveCredentialsResponseSchema.shape.scope.parse(scope)])
      const row = this.database.prepare('SELECT identity FROM drive_sync WHERE id=1').get()
      if (row && z.object({ identity: z.string() }).parse(row).identity !== expected) throw Error('DRIVE_SYNC_SCOPE_CHANGED')
      this.database.prepare('INSERT OR IGNORE INTO drive_sync(id,identity,value) VALUES(1,?,?)')
        .run(expected, JSON.stringify({ phase: 'idle', initialized: false, baseline: [], turn: null }))
      this.read()
    } catch (error) { this.database.close(); throw error }
  }

  close() { this.database.close() }

  read(): DriveSyncSnapshot {
    const row = z.object({ value: z.string() }).parse(this.database.prepare('SELECT value FROM drive_sync WHERE id=1').get())
    return validate(JSON.parse(row.value))
  }

  write(input: DriveSyncSnapshot): void {
    const value = JSON.stringify(validate(input))
    if (Buffer.byteLength(value) > 32 * 1024 * 1024) throw Error('DRIVE_SYNC_STATE_LIMIT')
    this.database.prepare('UPDATE drive_sync SET value=? WHERE id=1').run(value)
  }
}

function requirePrivatePath(root: string, path: string) {
  const tail = relative(root, path)
  if (tail === '' || !isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`)) throw Error('DRIVE_STATE_INSIDE_CACHE')
}

function validate(input: unknown): DriveSyncSnapshot {
  const parsed = snapshot.safeParse(input)
  if (!parsed.success) throw Error('DRIVE_SYNC_STATE_INVALID')
  const value = parsed.data
  const ids = new Set<string>(), paths = new Set<string>()
  for (const row of value.baseline) {
    drivePathSegments(row.entry.path)
    if (ids.has(row.entry.fileId)) throw Error('DRIVE_SYNC_AMBIGUOUS_BASELINE')
    ids.add(row.entry.fileId)
    if (row.local) {
      drivePathSegments(row.local.path)
      const path = portableDrivePathKey(row.local.path)
      if (paths.has(path)) throw Error('DRIVE_SYNC_AMBIGUOUS_BASELINE')
      paths.add(path)
      if (row.entry.kind === 'file' && row.entry.hydration === 'deferred') throw Error('DRIVE_SYNC_DEFERRED_LOCAL')
    }
  }
  if (value.phase === 'writing') drivePathSegments(value.operation.target.path)
  if (value.phase === 'hydrating') {
    drivePathSegments(value.path)
    if (value.entry.kind === 'file' && value.entry.hydration !== 'ready') throw Error('DRIVE_SYNC_DEFERRED_LOCAL')
  }
  return value
}
