import assert from 'node:assert/strict'
import test from 'node:test'
import { OVERLAY_AGENT_HOST_PACKAGE_VERSION, buildAgentHostEnrollmentCommand } from './agent-enrollment-command'

test('the enrollment command connects the machine with local tools and starts no third-party agent', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({ code: 'single-use-code', origin: 'https://overlay.works' }),
    `npx --yes --package node@24 --package @layernorm/overlay-agent-host@${OVERLAY_AGENT_HOST_PACKAGE_VERSION} overlay-agent-host connect single-use-code --server https://overlay.works --local-tools --run`,
  )
})

test('the enrollment command rejects shell-unsafe codes and non-HTTPS origins', () => {
  assert.throws(() => buildAgentHostEnrollmentCommand({ code: 'code;touch-pwned', origin: 'https://overlay.works' }))
  assert.throws(() => buildAgentHostEnrollmentCommand({ code: 'safe-code', origin: 'http://overlay.works' }))
})
