import assert from 'node:assert/strict'
import test from 'node:test'
import { readBoundedStorageBody } from './read-bounded-storage-body'

test('bounded storage reads preserve exact chunks and accept an empty body', async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close() } })
  assert.deepEqual(await readBoundedStorageBody(body, 3, 3), new Uint8Array([1, 2, 3]))
  assert.equal((await readBoundedStorageBody(new ReadableStream({ start(c) { c.close() } }), 0, 0)).length, 0)
})

test('an unknown or understated size cannot bypass the cap and cancels the source immediately', async () => {
  for (const declared of [undefined, 1]) {
    let pulls = 0; let cancelled = false
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(4)) }, cancel() { cancelled = true } }, { highWaterMark: 0 })
    await assert.rejects(readBoundedStorageBody(body, 3, declared), /STORAGE_READ_LIMIT_EXCEEDED/)
    assert.equal(cancelled, true); assert.equal(pulls, 1)
  }
})

test('oversized metadata cancels without reading; truncated bodies fail exact-size verification', async () => {
  let reads = 0; let cancelled = false
  const body = new ReadableStream<Uint8Array>({ pull() { reads++ }, cancel() { cancelled = true } }, { highWaterMark: 0 })
  await assert.rejects(readBoundedStorageBody(body, 3, 4), /STORAGE_READ_LIMIT_EXCEEDED/)
  assert.equal(reads, 0); assert.equal(cancelled, true)
  const short = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(2)); c.close() } })
  await assert.rejects(readBoundedStorageBody(short, 3, 3), /STORAGE_READ_SIZE_CHANGED/)
})
