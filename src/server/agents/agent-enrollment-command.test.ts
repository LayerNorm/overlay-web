import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentHostEnrollmentCommand } from './agent-enrollment-command'

test('the copyable enrollment command starts the selected harness in one step', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({
      code: 'single-use-code',
      origin: 'https://getoverlay.io',
      adapterId: 'claude-code',
    }),
    'npx --yes @overlay/agent-host@0.1.0 connect single-use-code --server https://getoverlay.io --adapter claude-code --run',
  )
})

test('the compatibility command still starts the host when no harness is selected', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({ code: 'single-use-code', origin: 'https://getoverlay.io' }),
    'npx --yes @overlay/agent-host@0.1.0 connect single-use-code --server https://getoverlay.io --run',
  )
})

test('the enrollment command rejects shell-unsafe codes and non-HTTPS origins', () => {
  assert.throws(
    () => buildAgentHostEnrollmentCommand({ code: 'code;touch-pwned', origin: 'https://getoverlay.io' }),
    /unsupported characters/,
  )
  assert.throws(
    () => buildAgentHostEnrollmentCommand({ code: 'safe-code', origin: 'http://getoverlay.io' }),
    /HTTPS origin/,
  )
})
