import assert from 'node:assert/strict'
import test from 'node:test'
import { OVERLAY_AGENT_HOST_PACKAGE_VERSION, buildAgentHostEnrollmentCommand } from './agent-enrollment-command'

/** The pinned host version must track the release constant, not a copied literal. */
function expectedCommand(params: { code: string; origin: string; adapterId?: string }): string {
  const adapter = params.adapterId ? ` --adapter ${params.adapterId}` : ''
  return `npx --yes --package node@24 --package @layernorm/overlay-agent-host@${OVERLAY_AGENT_HOST_PACKAGE_VERSION} overlay-agent-host connect ${params.code} --server ${params.origin}${adapter} --run`
}

test('the copyable enrollment command starts the selected harness in one step', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({
      code: 'single-use-code',
      origin: 'https://getoverlay.io',
      adapterId: 'claude-code',
    }),
    expectedCommand({ code: 'single-use-code', origin: 'https://getoverlay.io', adapterId: 'claude-code' }),
  )
})

test('the compatibility command still starts the host when no harness is selected', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({ code: 'single-use-code', origin: 'https://getoverlay.io' }),
    expectedCommand({ code: 'single-use-code', origin: 'https://getoverlay.io' }),
  )
})

test('the copyable enrollment command starts Hermes through its official ACP server', () => {
  assert.equal(
    buildAgentHostEnrollmentCommand({
      code: 'single-use-code',
      origin: 'https://getoverlay.io',
      adapterId: 'hermes',
    }),
    expectedCommand({ code: 'single-use-code', origin: 'https://getoverlay.io', adapterId: 'hermes' }),
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
