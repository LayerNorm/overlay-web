import assert from 'node:assert/strict'
import test from 'node:test'
import {insideTraceClip, hashTraceText} from './remote-ui-trace-dom'
import {remoteUiTraceRecord} from './remote-ui-trace-store'

test('a clipped, hidden or zero-size last glyph cannot count as visible output', () => {
  const clip = {left: 20, top: 40, right: 200, bottom: 100, cssVisible: true}
  const glyph = {x: 100, y: 50, width: 8, height: 14}
  assert.equal(insideTraceClip(glyph, clip), true)
  assert.equal(insideTraceClip({...glyph, y: 95}, clip), false)
  assert.equal(insideTraceClip({...glyph, x: 19.9}, clip), false)
  assert.equal(insideTraceClip({...glyph, width: 0}, clip), false)
  assert.equal(insideTraceClip(glyph, {...clip, cssVisible: false}), false)
})

test('export validation excludes plaintext and binds observations to one run, message and recording', async () => {
  const row = {version: 1, kind: 'sample', recordingId: 'd52c1e17-6556-4f1e-bde9-1fd44ce50427',
    runId: 'run-1', messageId: 'message-1', sequence: 1, at: 2000, before: 1990, monotonicMs: 1000, gapMs: 250,
    present: true, units: 3, sha256: await hashTraceText('abc'), visibility: 'visible',
    viewport: {width: 800, height: 600}, tail: null, text: 'private provider text', cookie: 'private cookie'}
  assert.equal(row.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const parsed = remoteUiTraceRecord.parse(row)
  assert.equal('text' in parsed, false)
  assert.equal('cookie' in parsed, false)
  assert.equal(parsed.runId, 'run-1')
  assert.equal(parsed.messageId, 'message-1')
  assert.equal(remoteUiTraceRecord.safeParse({...row, runId: ''}).success, false)
  assert.equal(remoteUiTraceRecord.safeParse({...row, sha256: 'not-a-hash'}).success, false)
  assert.equal(remoteUiTraceRecord.safeParse({...row, at: Infinity}).success, false)
})
