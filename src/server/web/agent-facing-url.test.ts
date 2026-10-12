import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_APP_URL = 'https://getoverlay.io'
process.env.NODE_ENV = 'production'

test('agent-facing URL defaults to the app URL and can name the host that answers without redirecting', async () => {
  const { getAgentFacingBaseUrl } = await import('./app-url')
  delete process.env.OVERLAY_AGENT_PUBLIC_URL
  assert.equal(getAgentFacingBaseUrl(), 'https://getoverlay.io')
  process.env.OVERLAY_AGENT_PUBLIC_URL = ' https://www.getoverlay.io/ '
  assert.equal(getAgentFacingBaseUrl(), 'https://www.getoverlay.io')
  delete process.env.OVERLAY_AGENT_PUBLIC_URL
})
