import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { drivePathSegments, portableDrivePathKey } from '@layernorm/overlay-agent-bridge-protocol'
export { drivePathSegments } from '@layernorm/overlay-agent-bridge-protocol'

export const DRIVE_CACHE_LIMITS = { fileBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, entries: 10000 } as const
export type DriveCacheLimits = { fileBytes: number; totalBytes: number; entries: number }
export type DriveCacheFile = { path: string; size: number; sha256: string; bytes: Uint8Array }
export type DriveCacheIdentity = { device: string; inode: string; birthtimeNs: string }
export type DriveCacheEntry = ({ kind: 'folder'; path: string } | { kind: 'file' } & DriveCacheFile) & { identity: DriveCacheIdentity }

function within(root: string, path: string): boolean {
  const tail = relative(root, path)
  return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))
}

/** Dedicated cache only. Its approved root is supplied by host filesystem authorization. */
export class AgentDriveCache {
  private constructor(readonly root: string, private readonly limits: DriveCacheLimits, private readonly temporaryRoot: string) {}

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
    // A crash can leave an atomic-write temporary behind. Keep it outside the scanned
    // drive so it can never be mistaken for an agent-created deliverable on restart.
    const temporaryRoot = join(approved, `.overlay-drive-tmp-${createHash('sha256').update(segment).digest('hex').slice(0, 16)}`)
    await mkdir(temporaryRoot, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    const temporary = await lstat(temporaryRoot)
    if (!temporary.isDirectory() || temporary.isSymbolicLink() || await realpath(temporaryRoot) !== temporaryRoot
      || temporary.dev !== stat.dev) throw Error('DRIVE_UNSAFE_CACHE')
    return new AgentDriveCache(root, limits, temporaryRoot)
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
    const temporaryDirectory = await lstat(this.temporaryRoot)
    if (!temporaryDirectory.isDirectory() || temporaryDirectory.isSymbolicLink()
      || await realpath(this.temporaryRoot) !== this.temporaryRoot) throw Error('DRIVE_UNSAFE_CACHE')
    const temporary = join(this.temporaryRoot, `.overlay-hydrate-${randomUUID()}`)
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

  /** Bootstrap reconciliation only, before an adapter process can write the cache. */
  async relocate(from: string, to: string, identity: DriveCacheIdentity): Promise<void> {
    const source = await this.checkedPath(from, false), destination = await this.checkedPath(to, true)
    await this.requireIdentity(source, identity)
    const occupied = await lstat(destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    })
    if (occupied) throw Error('DRIVE_LOCAL_PATH_CONFLICT')
    await rename(source, destination)
  }

  /** Never recursive: an untracked child prevents removal of a cached folder. */
  async removeUnchanged(entry: DriveCacheEntry): Promise<void> {
    const absolute = await this.checkedPath(entry.path, false)
    await this.requireIdentity(absolute, entry.identity)
    if (entry.kind === 'folder') await rmdir(absolute)
    else {
      const current = (await this.snapshot()).find(file => file.path === entry.path)
      if (!current || current.sha256 !== entry.sha256) throw Error('DRIVE_FILE_CHANGED')
      await unlink(absolute)
    }
  }

  private async requireIdentity(path: string, identity: DriveCacheIdentity) {
    const stat = await lstat(path, { bigint: true })
    if (stat.isSymbolicLink() || String(stat.dev) !== identity.device || String(stat.ino) !== identity.inode
      || String(stat.birthtimeNs) !== identity.birthtimeNs) throw Error('DRIVE_FILE_CHANGED')
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
        const stat = await lstat(absolute, { bigint: true })
        if (stat.isSymbolicLink()) throw Error('DRIVE_UNSAFE_PATH')
        const identity = { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }
        if (stat.isDirectory()) { files.push({ kind: 'folder', path, identity }); await visit(path); continue }
        if (!stat.isFile()) throw Error('DRIVE_SPECIAL_FILE')
        if (stat.nlink !== BigInt(1)) throw Error('DRIVE_HARD_LINK')
        if (stat.size > BigInt(this.limits.fileBytes)) throw Error('DRIVE_FILE_TOO_LARGE')
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const before = await handle.stat({ bigint: true })
          if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(this.limits.fileBytes) || before.ino !== stat.ino || before.dev !== stat.dev) throw Error('DRIVE_FILE_CHANGED')
          if ((totalBytes += Number(before.size)) > this.limits.totalBytes) throw Error('DRIVE_CACHE_TOO_LARGE')
          const bytes = new Uint8Array(Number(before.size))
          let read = 0
          while (read < bytes.length) {
            const result = await handle.read(bytes, read, bytes.length - read, read)
            if (!result.bytesRead) throw Error('DRIVE_FILE_CHANGED')
            read += result.bytesRead
          }
          const after = await handle.stat({ bigint: true })
          if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs
            || !within(this.root, await realpath(absolute))) throw Error('DRIVE_FILE_CHANGED')
          files.push({ kind: 'file', path, identity, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes })
        } finally { await handle.close() }
      }
    }
    await visit('')
    return files
  }
}
