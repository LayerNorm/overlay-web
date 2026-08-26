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
    'npx @overlay/agent-host connect single-use-code --server https://getoverlay.io --adapter claude-code --run',
  )
})

test('the compatibility command still starts the host when no harness is selected', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({ code: 'single-use-code', origin: 'https://getoverlay.io' }),
    'npx @overlay/agent-host connect single-use-code --server https://getoverlay.io --run',
  )
})
