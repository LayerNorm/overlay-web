import assert from 'node:assert/strict'
import test from 'node:test'
import {AgentDriveDownloadCache} from './agent-drive-download-cache'

test('range reads share immutable verified bytes, expire, and remain bounded during concurrent loads', async () => {
  let now = 0, reads = 0
  const cache = new AgentDriveDownloadCache(4, () => now)
  const load = async () => {reads++; return Uint8Array.from([1, 2, 3, 4])}
  const [first, second] = await Promise.all([cache.read('scope/revision', 4, load), cache.read('scope/revision', 4, load)])
  assert.equal(reads, 1)
  first[0] = 9
  assert.equal(second[0], 1)
  assert.equal((await cache.read('scope/revision', 4, load))[0], 1)
  now = 30_001
  await cache.read('scope/revision', 4, load)
  assert.equal(reads, 2)
  let release: (bytes: Uint8Array) => void = () => {throw Error('not initialized')}
  const pending = cache.read('another-scope', 4, () => new Promise(resolve => {release = resolve}))
  await Promise.resolve()
  await assert.rejects(cache.read('third-scope', 4, load), /DRIVE_DOWNLOAD_BUSY/)
  release(Uint8Array.of(4, 3, 2, 1))
  await pending
})

test('failed loads release reserved capacity and cannot poison retries', async () => {
  const cache = new AgentDriveDownloadCache(4)
  await assert.rejects(cache.read('failed', 4, async () => {throw Error('storage failure')}), /storage failure/)
  assert.deepEqual(await cache.read('failed', 4, async () => Uint8Array.of(1, 2, 3, 4)), Uint8Array.of(1, 2, 3, 4))
})

test('the retained verified buffer cannot be changed through the storage reader reference', async () => {
  const cache = new AgentDriveDownloadCache(4)
  const source = Uint8Array.of(1, 2, 3, 4)
  await cache.read('immutable', 4, async () => source)
  source[0] = 9
  assert.equal((await cache.read('immutable', 4, async () => {throw Error('unexpected reread')}))[0], 1)
})
