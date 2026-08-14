import assert from 'node:assert/strict'
import test from 'node:test'
import { abortToolLoopRuns, registerToolLoopRun } from './tool-loop-run-registry'

test('registered ToolLoop runs can be aborted and removed', () => {
  const controller = new AbortController()
  const unregister = registerToolLoopRun('run_1', controller)

  assert.equal(abortToolLoopRuns(['missing', 'run_1']), 1)
  assert.equal(controller.signal.aborted, true)
  assert.equal(controller.signal.reason, 'cancelled_by_user')
  assert.equal(abortToolLoopRuns(['run_1']), 0)

  unregister()
})

test('unregister only removes the matching controller', () => {
  const first = new AbortController()
  const second = new AbortController()
  const unregisterFirst = registerToolLoopRun('run_2', first)
  const unregisterSecond = registerToolLoopRun('run_2', second)

  unregisterFirst()
  assert.equal(abortToolLoopRuns(['run_2']), 1)
  assert.equal(first.signal.aborted, false)
  assert.equal(second.signal.aborted, true)

  unregisterSecond()
})

test('runs without an ID are intentionally not registered', () => {
  const controller = new AbortController()
  const unregister = registerToolLoopRun(undefined, controller)

  assert.equal(abortToolLoopRuns([]), 0)
  assert.equal(controller.signal.aborted, false)
  unregister()
})
