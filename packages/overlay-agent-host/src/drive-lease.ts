import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { driveCredentialsResponseSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { z } from 'zod'

type DriveScope = z.infer<typeof driveCredentialsResponseSchema.shape.scope>

/** Separate private database: hold this lease through hydration, prompting and final sync.
 * SQLite's OS lock releases after process loss. Never delete/replace the lease file to steal it.
 */
export class AgentDriveLease {
  private released = false
  private constructor(private readonly database: DatabaseSync) {}

  static acquire(path: string, cacheRoot: string, scope: DriveScope): AgentDriveLease {
    const parsed = driveCredentialsResponseSchema.shape.scope.safeParse(scope)
    if (!parsed.success) throw Error('DRIVE_LEASE_SCOPE_INVALID')
    const root = realpathSync(cacheRoot)
    const stat = lstatSync(cacheRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('DRIVE_UNSAFE_CACHE')
    requireOutsideCache(root, resolve(path))
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    requireOutsideCache(root, join(realpathSync(dirname(path)), basename(path)))
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('DRIVE_UNSAFE_LEASE')
    } else {
      try { closeSync(openSync(path, 'wx', 0o600)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('DRIVE_UNSAFE_LEASE')
    }
    chmodSync(path, 0o600)
    const database = new DatabaseSync(path)
    try {
      database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
      database.exec('CREATE TABLE IF NOT EXISTS drive_cache_identity (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
      const identity = JSON.stringify([root, parsed.data])
      const prior = database.prepare('SELECT value FROM drive_cache_identity WHERE id=1').get()
      if (prior && z.object({ value: z.string() }).parse(prior).value !== identity) throw Error('DRIVE_LEASE_SCOPE_CHANGED')
      database.prepare('INSERT OR IGNORE INTO drive_cache_identity(id,value) VALUES(1,?)').run(identity)
      // Persist the immutable identity, then take the lifetime lock. Another contender may win
      // between transactions; that correctly fails this acquisition without touching the cache.
      database.exec('COMMIT; BEGIN EXCLUSIVE;')
      return new AgentDriveLease(database)
    } catch (error) {
      database.close()
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR'
        && 'errcode' in error && error.errcode === 5) throw Error('DRIVE_CACHE_BUSY')
      throw error
    }
  }

  release(): void {
    if (this.released) return
    this.database.exec('ROLLBACK')
    this.database.close()
    this.released = true
  }
}

function requireOutsideCache(root: string, path: string) {
  const tail = relative(root, path)
  if (tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))) throw Error('DRIVE_LEASE_INSIDE_CACHE')
}
