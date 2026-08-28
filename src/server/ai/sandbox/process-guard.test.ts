import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSandboxProcessGuardedCommand } from './process-guard'

test('process guard fails closed and terminates the command process group', () => {
  const script = buildSandboxProcessGuardedCommand({
    commandPath: "/sandbox/run/command's.sh",
    stderrPath: '/sandbox/run/stderr',
    stdoutPath: '/sandbox/run/stdout',
  })

  assert.match(script, /command -v setsid/)
  assert.match(script, /kill -TERM -- "-\$COMMAND_PID"/)
  assert.match(script, /kill -KILL -- "-\$COMMAND_PID"/)
  assert.match(script, /command'\\''s\.sh/)
  assert.doesNotMatch(script, /tx_bytes|EGRESS_LIMIT/)
})
