import assert from 'node:assert/strict'
import test from 'node:test'
import { computerRecordingDriverArgs } from './overlay-executes'

test('each recording action sends only its own fields to the driver', () => {
  assert.deepEqual(computerRecordingDriverArgs({ action: 'start', title: 'QA', fps: 5, label: 'ignored', public: true }), { ok: true, args: { title: 'QA', fps: 5 } })
  assert.deepEqual(computerRecordingDriverArgs({ action: 'status', id: 'r-000000000000' }), { ok: true, args: {} })
  assert.deepEqual(
    computerRecordingDriverArgs({ action: 'annotate', id: 'r-000000000000', label: 'Login works', status: 'pass', title: 'x' }),
    { ok: true, args: { id: 'r-000000000000', label: 'Login works', status: 'pass' } },
  )
  assert.deepEqual(computerRecordingDriverArgs({ action: 'stop', id: 'r-000000000000', public: true, name: 'demo' }), { ok: true, args: { id: 'r-000000000000' } })
})

test('annotate and stop fail early without an id or label', () => {
  assert.equal(computerRecordingDriverArgs({ action: 'stop' }).ok, false)
  assert.equal(computerRecordingDriverArgs({ action: 'annotate', id: 'r-000000000000' }).ok, false)
  assert.equal(computerRecordingDriverArgs({ action: 'annotate', id: 'r-000000000000', label: '   ' }).ok, false)
})
