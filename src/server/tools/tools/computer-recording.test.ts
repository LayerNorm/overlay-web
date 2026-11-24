import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computerRecordingChapters,
  computerRecordingFileName,
  parseComputerRecordingStop,
  summarizeComputerRecording,
} from './computer-recording'

const payload = {
  id: 'r-9609955f78e0',
  path: '/tmp/overlay-computer/recordings/r-9609955f78e0/recording.mp4',
  sizeBytes: 9927,
  durationSeconds: 65.2,
  title: 'Smoke test',
  annotations: [
    { t: 0.6, label: 'Open app', status: 'setup' },
    { t: 2.15, label: 'Login works', status: 'pass' },
    { t: 63.68, label: 'Export', status: 'fail' },
    { t: 64, label: 'weird', status: 'bogus' },
    { nope: true },
  ],
}

test('stop payloads are parsed defensively and counts are recomputed', () => {
  const stop = parseComputerRecordingStop(payload)!
  assert.equal(stop.annotations.length, 4)
  assert.equal(stop.annotations[3]!.status, 'step')
  assert.deepEqual(stop.counts, { setup: 1, step: 1, pass: 1, fail: 1 })
  assert.equal(parseComputerRecordingStop({ id: 'x' }), null)
})

test('the summary reports duration and pass/fail checks', () => {
  assert.equal(summarizeComputerRecording({ durationSeconds: 65.2, counts: { setup: 1, step: 0, pass: 2, fail: 1 } }), '1m 05s recording, 3 checks: 2 passed, 1 failed')
  assert.equal(summarizeComputerRecording({ durationSeconds: 4.8, counts: { setup: 0, step: 0, pass: 1, fail: 0 } }), '5s recording, 1 check: 1 passed')
  assert.equal(summarizeComputerRecording({ durationSeconds: 12, counts: { setup: 1, step: 2, pass: 0, fail: 0 } }), '12s recording, 3 steps, no pass/fail checks')
  assert.equal(summarizeComputerRecording({ durationSeconds: 3, counts: { setup: 0, step: 0, pass: 0, fail: 0 } }), '3s recording')
})

test('chapters carry m:ss timestamps', () => {
  const chapters = computerRecordingChapters(parseComputerRecordingStop(payload)!.annotations)
  assert.deepEqual(chapters.map(chapter => chapter.at), ['0:00', '0:02', '1:03', '1:04'])
})

test('file names are safe and always end in .mp4', () => {
  assert.equal(computerRecordingFileName({ id: 'r-1', title: 'Login / export: QA' }), 'Login export QA.mp4')
  assert.equal(computerRecordingFileName({ id: 'r-1', title: '' }), 'Recording r-1.mp4')
  assert.equal(computerRecordingFileName({ id: 'r-1', title: 'x' }, 'demo.MP4'), 'demo.mp4')
})
