import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { drivePathSegments, portableDrivePathKey } from '@layernorm/overlay-agent-bridge-protocol'
export { drivePathSegments } from '@layernorm/overlay-agent-bridge-protocol'

export const DRIVE_CACHE_LIMITS = { fileBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, entries: 10000 } as const
export type DriveCacheLimits = { fileBytes: number; totalBytes: number; entries: number }
export type DriveCacheFile = { path: string; size: number; sha256: string; bytes: Uint8Array }
export type DriveCacheIdentity = { device: string; inode: string; birthtimeMs: number }
export type DriveCacheEntry = ({ kind: 'folder'; path: string } | { kind: 'file' } & DriveCacheFile) & { identity: DriveCacheIdentity }

function within(root: string, path: string): boolean {
  const tail = relative(root, path)
  return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))
}

/** Dedicated cache only. Its approved root is supplied by host filesystem authorization. */
export class AgentDriveCache {
  private constructor(readonly root: string, private readonly limits: DriveCacheLimits) {}

  static async create(approvedRoot: string, cacheName: string, limits: DriveCacheLimits = DRIVE_CACHE_LIMITS) {
    const [segment, ...rest] = drivePathSegments(cacheName)
    if (rest.length || !segment) throw Error('DRIVE_CACHE_NAME_INVALID')
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw Error('DRIVE_LIMIT_INVALID')
    const approved = await realpath(approvedRoot)
    const root = join(approved, segment)
    await mkdir(root, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw Error('DRIVE_UNSAFE_CACHE')
    return new AgentDriveCache(root, limits)
  }

  private async checkedPath(path: string, createParents: boolean): Promise<string> {
    const segments = drivePathSegments(path)
    let current = this.root
    const root = await lstat(current)
    if (!root.isDirectory() || root.isSymbolicLink() || await realpath(current) !== this.root) throw Error('DRIVE_UNSAFE_CACHE')
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment)
      if (createParents) await mkdir(current, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      const stat = await lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink() || !within(this.root, await realpath(current))) throw Error('DRIVE_UNSAFE_PATH')
    }
    return resolve(current, segments.at(-1)!)
  }

  async hydrate(path: string, bytes: Uint8Array, expectedHash: string): Promise<void> {
    if (bytes.byteLength > this.limits.fileBytes) throw Error('DRIVE_FILE_TOO_LARGE')
    const verifiedBytes = Uint8Array.from(bytes)
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || createHash('sha256').update(verifiedBytes).digest('hex') !== expectedHash) throw Error('DRIVE_HASH_MISMATCH')
    const destination = await this.checkedPath(path, true)
    const existing = await lstat(destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    })
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw Error('DRIVE_UNSAFE_PATH')
    const temporary = join(dirname(destination), `.overlay-hydrate-${randomUUID()}`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(verifiedBytes)
      await handle.sync()
      await handle.close()
      if (await this.checkedPath(path, false) !== destination) throw Error('DRIVE_UNSAFE_PATH')
      await rename(temporary, destination)
    } finally {
      await handle.close().catch(() => undefined)
      await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    }
  }

  async ensureFolder(path: string): Promise<void> {
    const absolute = await this.checkedPath(path, true)
    await mkdir(absolute, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    const stat = await lstat(absolute)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !within(this.root, await realpath(absolute))) throw Error('DRIVE_UNSAFE_PATH')
  }

  async snapshot(): Promise<DriveCacheFile[]> {
    return (await this.inventory()).flatMap(entry => entry.kind === 'file'
      ? [{ path: entry.path, size: entry.size, sha256: entry.sha256, bytes: entry.bytes }] : [])
  }

  /** Include empty folders and stable local identities; equal hashes alone never prove a rename. */
  async inventory(): Promise<DriveCacheEntry[]> {
    const files: DriveCacheEntry[] = []
    const names = new Set<string>()
    let totalBytes = 0, entries = 0
    const visit = async (prefix: string) => {
      const directory = prefix ? await this.checkedPath(`${prefix}/.scan`, false) : join(this.root, '.scan')
      // Validate the root even for an empty directory.
      if (!prefix) await this.checkedPath('.scan', false)
      for (const name of (await readdir(dirname(directory))).sort()) {
        const path = prefix ? `${prefix}/${name}` : name
        if (++entries > this.limits.entries) throw Error('DRIVE_TOO_MANY_ENTRIES')
        const absolute = await this.checkedPath(path, false)
        // Reject case/normalization collisions so a fresh machine cannot overwrite one entry with another.
        const portable = portableDrivePathKey(path)
        if (names.has(portable)) throw Error('DRIVE_AMBIGUOUS_PATH')
        names.add(portable)
        const stat = await lstat(absolute)
        if (stat.isSymbolicLink()) throw Error('DRIVE_UNSAFE_PATH')
        const identity = { device: String(stat.dev), inode: String(stat.ino), birthtimeMs: stat.birthtimeMs }
        if (stat.isDirectory()) { files.push({ kind: 'folder', path, identity }); await visit(path); continue }
        if (!stat.isFile()) throw Error('DRIVE_SPECIAL_FILE')
        if (stat.nlink !== 1) throw Error('DRIVE_HARD_LINK')
        if (stat.size > this.limits.fileBytes) throw Error('DRIVE_FILE_TOO_LARGE')
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const before = await handle.stat()
          if (!before.isFile() || before.nlink !== 1 || before.size > this.limits.fileBytes || before.ino !== stat.ino || before.dev !== stat.dev) throw Error('DRIVE_FILE_CHANGED')
          if ((totalBytes += before.size) > this.limits.totalBytes) throw Error('DRIVE_CACHE_TOO_LARGE')
          const bytes = new Uint8Array(before.size)
          let read = 0
          while (read < bytes.length) {
            const result = await handle.read(bytes, read, bytes.length - read, read)
            if (!result.bytesRead) throw Error('DRIVE_FILE_CHANGED')
            read += result.bytesRead
          }
          const after = await handle.stat()
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
            || !within(this.root, await realpath(absolute))) throw Error('DRIVE_FILE_CHANGED')
          files.push({ kind: 'file', path, identity, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes })
        } finally { await handle.close() }
      }
    }
    await visit('')
    return files
  }
}
