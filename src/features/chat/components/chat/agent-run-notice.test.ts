import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentRunNotice } from './agent-run-notice'

test('announces a live same-run cancellation', () => {
  assert.deepEqual(
    resolveAgentRunNotice(
      { id: 'run-1', status: 'running' },
      { id: 'run-1', status: 'cancelled' },
    ),
    { notice: 'Work stopped.', announce: true },
  )
})

test('announces a live same-run failure with its message', () => {
  assert.deepEqual(
    resolveAgentRunNotice(
      { id: 'run-1', status: 'running' },
      {
        id: 'run-1',
        status: 'failed',
        terminalError: { code: 'work_failed', message: 'The agent failed.', retryable: false },
      },
    ),
    { notice: 'Work failed: The agent failed.', announce: true },
  )
})

test('does not announce a cancellation first observed as terminal', () => {
  assert.deepEqual(
    resolveAgentRunNotice(null, { id: 'run-1', status: 'cancelled' }),
    { notice: 'Work stopped.', announce: false },
  )
})

test('does not announce a terminal update for a different run', () => {
  assert.deepEqual(
    resolveAgentRunNotice(
      { id: 'run-1', status: 'running' },
      { id: 'run-2', status: 'cancelled' },
    ),
    { notice: 'Work stopped.', announce: false },
  )
})

test('does not announce a repeated cancellation', () => {
  assert.deepEqual(
    resolveAgentRunNotice(
      { id: 'run-1', status: 'cancelled' },
      { id: 'run-1', status: 'cancelled' },
    ),
    { notice: 'Work stopped.', announce: false },
  )
})
