import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { link, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentDriveCache, drivePathSegments } from './drive-cache.js'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-drive-cache-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('portable wire paths preserve nested Unicode and reject traversal and machine-specific aliases', () => {
  assert.deepEqual(drivePathSegments('研究/notes café.md'), ['研究', 'notes café.md'])
  for (const path of ['', '/etc/passwd', '../x', 'a/../x', 'a//x', 'a/./x', 'a\\x', 'C:/x', 'a\0x', 'CON', 'nul.txt', 'x. ', 'a/b/']) {
    assert.throws(() => drivePathSegments(path), /DRIVE_UNSAFE_PATH/, path)
  }
})

test('fresh-cache hydration preserves full text and binary hashes without scanning siblings', async () => fixture(async directory => {
  await writeFile(join(directory, 'private-sibling.txt'), 'must not scan')
  const first = await AgentDriveCache.create(directory, 'first-cache')
  const text = new TextEncoder().encode('研究🙂\n'.repeat(60000))
  const binary = new Uint8Array([0, 255, 1, 2, 3])
  await first.hydrate('研究/report.md', text, hash(text))
  await first.hydrate('assets/data.bin', binary, hash(binary))
  const snapshot = await first.snapshot()
  assert.deepEqual(snapshot.map(file => file.path), ['assets/data.bin', '研究/report.md'])
  const fresh = await AgentDriveCache.create(directory, 'fresh-cache')
  for (const file of snapshot) await fresh.hydrate(file.path, file.bytes, file.sha256)
  assert.deepEqual(await fresh.snapshot(), snapshot)
  assert.equal(await readFile(join(directory, 'private-sibling.txt'), 'utf8'), 'must not scan')
  assert.ok(snapshot.find(file => file.path.endsWith('report.md'))!.size > 512000)
}))

test('bad download hashes never replace existing files and temporary writes are cleaned', async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache')
  const original = new TextEncoder().encode('original')
  await cache.hydrate('file.txt', original, hash(original))
  await assert.rejects(cache.hydrate('file.txt', new TextEncoder().encode('different'), hash(original)), /DRIVE_HASH_MISMATCH/)
  assert.equal(await readFile(join(cache.root, 'file.txt'), 'utf8'), 'original')
  assert.deepEqual(await readdir(cache.root), ['file.txt'])
}))

test('inventory preserves empty folders and distinguishes renamed files from equal-content copies', async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache')
  await cache.ensureFolder('Empty/nested')
  await writeFile(join(cache.root, 'original.txt'), 'equal bytes')
  const before = await cache.inventory()
  assert.deepEqual(before.filter(entry => entry.kind === 'folder').map(entry => entry.path), ['Empty', 'Empty/nested'])
  const original = before.find(entry => entry.path === 'original.txt')!
  await rename(join(cache.root, 'original.txt'), join(cache.root, 'renamed.txt'))
  await writeFile(join(cache.root, 'copied.txt'), 'equal bytes')
  const after = await cache.inventory()
  const renamed = after.find(entry => entry.path === 'renamed.txt')!, copied = after.find(entry => entry.path === 'copied.txt')!
  assert.deepEqual(renamed.identity, original.identity)
  assert.notDeepEqual(copied.identity, original.identity)
  assert.equal(renamed.kind === 'file' && copied.kind === 'file' && renamed.sha256 === copied.sha256, true)
  const fresh = await AgentDriveCache.create(directory, 'fresh')
  for (const entry of after) {
    if (entry.kind === 'folder') await fresh.ensureFolder(entry.path)
    else await fresh.hydrate(entry.path, entry.bytes, entry.sha256)
  }
  assert.deepEqual((await fresh.inventory()).map(({ kind, path }) => ({ kind, path })), after.map(({ kind, path }) => ({ kind, path })))
}))

test('a caller cannot change the verified download while its atomic write is awaiting I/O', async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache')
  const bytes = new TextEncoder().encode('verified')
  const pending = cache.hydrate('file', bytes, hash(bytes))
  bytes.fill(0)
  await pending
  assert.equal(await readFile(join(cache.root, 'file'), 'utf8'), 'verified')
}))

test('hard links to files outside the cache are never uploaded by a snapshot', async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache')
  await writeFile(join(directory, 'private'), 'private')
  await link(join(directory, 'private'), join(cache.root, 'linked'))
  await assert.rejects(cache.snapshot(), /DRIVE_HARD_LINK/)
}))

test('cache bounds fail explicitly rather than silently omitting files', async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache', { fileBytes: 8, totalBytes: 10, entries: 2 })
  const large = new Uint8Array(9)
  await assert.rejects(cache.hydrate('large', large, hash(large)), /DRIVE_FILE_TOO_LARGE/)
  await writeFile(join(cache.root, 'one'), '123456')
  await writeFile(join(cache.root, 'two'), '123456')
  await assert.rejects(cache.snapshot(), /DRIVE_CACHE_TOO_LARGE/)
  await writeFile(join(cache.root, 'one'), '123456789')
  await assert.rejects(cache.snapshot(), /DRIVE_FILE_TOO_LARGE/)
  await writeFile(join(cache.root, 'one'), '')
  await writeFile(join(cache.root, 'three'), '')
  await assert.rejects(cache.snapshot(), /DRIVE_TOO_MANY_ENTRIES/)
}))

test('symlink files, symlink folders and a symlink cache root are refused', { skip: process.platform === 'win32' }, async () => fixture(async directory => {
  const cache = await AgentDriveCache.create(directory, 'cache')
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'secret'), 'outside')
  await symlink(outside, join(directory, 'linked-cache'), 'dir')
  await assert.rejects(AgentDriveCache.create(directory, 'linked-cache'), /DRIVE_UNSAFE_CACHE/)
  await symlink(outside, join(cache.root, 'linked'), 'dir')
  await assert.rejects(cache.snapshot(), /DRIVE_UNSAFE_PATH/)
  const bytes = new Uint8Array([1])
  await assert.rejects(cache.hydrate('linked/new', bytes, hash(bytes)), /DRIVE_UNSAFE_PATH/)
  await rm(join(cache.root, 'linked'))
  await symlink(join(outside, 'secret'), join(cache.root, 'secret'))
  await assert.rejects(cache.snapshot(), /DRIVE_UNSAFE_PATH/)
  await assert.rejects(cache.hydrate('secret', bytes, hash(bytes)), /DRIVE_UNSAFE_PATH/)
  assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'outside')
}))
