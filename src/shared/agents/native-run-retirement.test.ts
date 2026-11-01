import assert from 'node:assert/strict'
import test from 'node:test'
import { assertNativeHarnessRun, assertSupportedAgentExecution, isRetiredNativeRun } from './native-run-retirement'

test('native admission requires both the workflow runner and Harness engine', () => {
  assert.doesNotThrow(() => assertNativeHarnessRun({ runner: 'workflow', executionEngine: 'overlay_harness' }))
  for (const identity of [
    { runner: 'workflow' }, { runner: 'tool_loop' }, { runner: 'remote' },
    { runner: 'tool_loop', executionEngine: 'overlay_harness' },
  ]) assert.throws(() => assertNativeHarnessRun(identity), /native_runner_retired/)
})

test('historical native runs are retired but connected external agents remain supported', () => {
  assert.equal(isRetiredNativeRun({ runner: 'workflow' }), true)
  assert.equal(isRetiredNativeRun({ runner: 'remote' }), false)
  assert.doesNotThrow(() => assertSupportedAgentExecution({ runner: 'remote' }))
})
