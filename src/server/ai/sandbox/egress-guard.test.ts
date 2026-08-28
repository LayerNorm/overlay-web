import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSandboxEgressGuardedCommand, SANDBOX_EGRESS_LIMIT_EXIT_CODE } from './egress-guard'

test('egress guard fails closed and terminates the command process group at the byte ceiling', () => {
  const script = buildSandboxEgressGuardedCommand({
    commandPath: "/sandbox/run/command's.sh",
    markerPath: '/sandbox/run/egress-limit',
    maxEgressBytes: 123.9,
    stderrPath: '/sandbox/run/stderr',
    stdoutPath: '/sandbox/run/stdout',
  })

  assert.match(script, /OVERLAY_EGRESS_LIMIT=123/)
  assert.match(script, /command -v setsid/)
  assert.match(script, /kill -TERM -- "-\$COMMAND_PID"/)
  assert.match(script, new RegExp(`EXIT_CODE=${SANDBOX_EGRESS_LIMIT_EXIT_CODE}`))
  assert.match(script, /command'\\''s\.sh/)
})
