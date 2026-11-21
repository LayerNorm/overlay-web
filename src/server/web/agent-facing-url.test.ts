import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_APP_URL = 'https://overlay.works'
process.env.NODE_ENV = 'production'

test('agent-facing URL defaults to the app URL and can name the host that answers without redirecting', async () => {
  const { getAgentFacingBaseUrl } = await import('./app-url')
  delete process.env.OVERLAY_AGENT_PUBLIC_URL
  assert.equal(getAgentFacingBaseUrl(), 'https://overlay.works')
  process.env.OVERLAY_AGENT_PUBLIC_URL = ' https://overlay.works/ '
  assert.equal(getAgentFacingBaseUrl(), 'https://overlay.works')
  delete process.env.OVERLAY_AGENT_PUBLIC_URL
})
