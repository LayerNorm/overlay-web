import assert from 'node:assert/strict'
import test from 'node:test'
import { OVERLAY_AGENT_HOST_PACKAGE_VERSION, buildAgentHostEnrollmentCommand } from './agent-enrollment-command'

test('the enrollment command connects the machine with local tools and starts no third-party agent', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({ code: 'single-use-code', origin: 'https://getoverlay.io' }),
    `npx --yes --package node@24 --package @layernorm/overlay-agent-host@${OVERLAY_AGENT_HOST_PACKAGE_VERSION} overlay-agent-host connect single-use-code --server https://getoverlay.io --local-tools --run`,
  )
})

test('the enrollment command rejects shell-unsafe codes and non-HTTPS origins', () => {
  assert.throws(() => buildAgentHostEnrollmentCommand({ code: 'code;touch-pwned', origin: 'https://getoverlay.io' }))
  assert.throws(() => buildAgentHostEnrollmentCommand({ code: 'safe-code', origin: 'http://getoverlay.io' }))
})
