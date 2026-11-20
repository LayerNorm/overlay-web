import { expect, test } from 'vitest'
import { mergePublicStreamUpdates, publicStreamCursors, type PublicStreamUpdate } from './public-stream-updates'

const identity = { assistantMessageId: 'reply', runId: 'run', executionGeneration: 0, receiptId: 'model:0', invocation: 0 }
const update = (sequence: number, fromSegmentIndex: number, segments: string[], extra: Partial<PublicStreamUpdate> = {}): PublicStreamUpdate => ({
  ...identity, sequence, fromSegmentIndex,
  segments: segments.map((text, offset) => ({ index: fromSegmentIndex + offset, text })), ...extra,
})

test('incremental reads extend the growing segment and append new ones', () => {
  let held = mergePublicStreamUpdates(new Map(), [update(0, 0, ['Hel'])])
  expect(publicStreamCursors(held, ['reply'])).toEqual([{
    assistantMessageId: 'reply', runId: 'run', executionGeneration: 0, invocation: 0, segmentIndex: 0,
  }])
  const growing = mergePublicStreamUpdates(held, [update(1, 0, ['Hello'])])
  // The cursor does not move while a segment grows, so the read keeps one subscription.
  expect(publicStreamCursors(growing, ['reply'])).toEqual(publicStreamCursors(held, ['reply']))
  held = mergePublicStreamUpdates(held, [update(1, 0, ['Hello', ' world'])])
  expect(held.get('reply')?.snapshot.text).toBe('Hello world')
  held = mergePublicStreamUpdates(held, [update(2, 1, [' world!'])])
  expect(held.get('reply')?.snapshot).toMatchObject({ text: 'Hello world!', sequence: 2 })
  expect(publicStreamCursors(held, ['reply'])[0]).toMatchObject({ segmentIndex: 1 })
  expect(publicStreamCursors(held, ['reply'])[0]).not.toHaveProperty('sequence')
})

test('an unchanged read keeps the same map, and a stale read never rolls text back', () => {
  const held = mergePublicStreamUpdates(new Map(), [update(3, 0, ['Done'])])
  expect(mergePublicStreamUpdates(held, [update(3, 1, [])])).toBe(held)
  // The reader re-reads its last segment every time; the same text keeps the same map.
  expect(mergePublicStreamUpdates(held, [update(3, 0, ['Done'])])).toBe(held)
  expect(mergePublicStreamUpdates(held, [update(2, 0, ['Do'])])).toBe(held)
})

test('a new invocation or generation replaces the held text, and finished replies drop out', () => {
  const held = mergePublicStreamUpdates(new Map(), [update(3, 0, ['First call'])])
  const next = mergePublicStreamUpdates(held, [update(0, 0, ['Second'], { receiptId: 'model:1', invocation: 1 })])
  expect(next.get('reply')?.snapshot).toMatchObject({ text: 'Second', invocation: 1 })
  const retried = mergePublicStreamUpdates(next, [update(0, 0, ['Retry'], { executionGeneration: 1, receiptId: 'model:1', invocation: 1 })])
  expect(retried.get('reply')?.snapshot).toMatchObject({ text: 'Retry', executionGeneration: 1 })
  expect(mergePublicStreamUpdates(retried, []).size).toBe(0)
})

test('a gap keeps the visible text and asks for the whole stream next', () => {
  const held = mergePublicStreamUpdates(new Map(), [update(1, 0, ['Visible'])])
  const gapped = mergePublicStreamUpdates(held, [update(4, 3, ['lost'])])
  expect(gapped.get('reply')?.snapshot.text).toBe('Visible')
  expect(publicStreamCursors(gapped, ['reply'])).toEqual([])
  const reread = mergePublicStreamUpdates(gapped, [update(4, 0, ['Visible', ' and more'])])
  expect(reread.get('reply')?.snapshot.text).toBe('Visible and more')
  expect(publicStreamCursors(reread, ['reply'])).toHaveLength(1)
})

test('truncation and continuation flags travel with the snapshot', () => {
  const held = mergePublicStreamUpdates(new Map(), [update(0, 0, ['tail'], { truncatedMarker: '[Additional output omitted]', continuesPrevious: true })])
  expect(held.get('reply')?.snapshot).toMatchObject({ truncatedMarker: '[Additional output omitted]', continuesPrevious: true })
})
