import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createPublicTranscriptStream, readPublicTranscriptStep } from './public-transcript'
import { compactTranscriptSnapshot } from './transcript-snapshot'

afterEach(() => vi.unstubAllGlobals())

test('full stored payload survives gzip and digest verification, including long and deeply nested values', async () => {
  const input = { content: 'An update.', parts: [{ type: 'tool-invocation', toolInvocation: {
    toolCallId: 'call', toolName: 'read_file', toolOutput: { body: 'complete '.repeat(4_000) },
  } }] }
  const json = JSON.stringify(input)
  const fetch = vi.fn().mockResolvedValue(new Response(Uint8Array.from(gzipSync(json)).buffer))
  vi.stubGlobal('fetch', fetch)
  const step = { sequence: 0, persistence: { content: '', parts: [] }, fullPersistenceUrl: 'https://storage.test/full',
    fullPersistenceDigest: createHash('sha256').update(json).digest('hex') }
  expect(await readPublicTranscriptStep(step, new AbortController().signal)).toEqual({ persistence: input, legacy: false })
  fetch.mockResolvedValueOnce(new Response(Uint8Array.from(gzipSync(json)).buffer))
  await expect(readPublicTranscriptStep({ ...step, fullPersistenceDigest: 'a'.repeat(64) }, new AbortController().signal))
    .rejects.toThrow('integrity')
  await expect(readPublicTranscriptStep({ ...step, fullPersistenceUrl: null }, new AbortController().signal))
    .rejects.toThrow('unavailable')
})

test('streams all historical pages in order, marks legacy storage and rejects a repeated cursor', async () => {
  const step = (sequence: number) => ({ sequence, persistence: { content: `Step ${sequence}`, parts: [{ type: 'text', text: `Step ${sequence}` }] } })
  const firstPage = { steps: Array.from({ length: 10 }, (_, index) => step(index)), nextSequence: 9, resultSummary: 'Finished.' }
  const loadPage = vi.fn().mockResolvedValue({ steps: [step(10)], nextSequence: null })
  const stream = createPublicTranscriptStream({ firstPage, loadPage, signal: new AbortController().signal })
  const records = (await new Response(stream).text()).trim().split('\n').map(line => JSON.parse(line))
  expect(records.filter(record => record.type === 'step').map(record => record.sequence)).toEqual(Array.from({ length: 11 }, (_, index) => index))
  expect(records.at(-1)).toEqual({ type: 'done', legacy: true, resultSummary: 'Finished.' })
  expect(loadPage).toHaveBeenCalledExactlyOnceWith(9)
  const invalid = createPublicTranscriptStream({ firstPage, loadPage: async () => firstPage, signal: new AbortController().signal })
  const invalidRecords = (await new Response(invalid).text()).trim().split('\n').map(line => JSON.parse(line))
  expect(invalidRecords.at(-1).type).toBe('error')
  expect(invalidRecords.some(record => record.type === 'done')).toBe(false)
})

test('delivery snapshot fits the byte limit even with large Unicode values and retains its last answer', () => {
  const input = { content: '界'.repeat(170_000), parts: [
    ...Array.from({ length: 100 }, (_, index) => ({ type: 'tool-invocation', toolInvocation: {
      toolCallId: `call-${index}`, toolName: 'read_file', toolOutput: { value: '界'.repeat(8_000) },
    } })), { type: 'text', text: 'The final answer.' },
  ] }
  const snapshot = compactTranscriptSnapshot(input)
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(256 * 1024)
  expect(snapshot.content.length).toBeLessThanOrEqual(160_000)
  expect(snapshot.parts.length).toBeLessThanOrEqual(81)
  expect(snapshot.parts.at(-1)).toEqual({ type: 'text', text: 'The final answer.' })
  expect(input.parts).toHaveLength(101)
})
