import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

// The configured app URL is the apex; the site actually serves from www and redirects the apex to it.
process.env.NEXT_PUBLIC_APP_URL = 'https://getoverlay.io'
process.env.NODE_ENV = 'production'

const request = (url: string, forwardedHost?: string) => ({
  url,
  headers: new Headers(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
})

test('advertised URLs follow the host the client called, for the app\'s own host and its www twin', async () => {
  const { mcpBaseUrl } = await import('./mcp-http')
  assert.equal(mcpBaseUrl(request('https://www.getoverlay.io/api/mcp')), 'https://www.getoverlay.io')
  assert.equal(mcpBaseUrl(request('https://getoverlay.io/api/mcp')), 'https://getoverlay.io')
  assert.equal(mcpBaseUrl(request('http://localhost:3000/api/mcp', 'www.getoverlay.io')), 'https://www.getoverlay.io')
})

test('a host that is not the app\'s own cannot choose the advertised URLs', async () => {
  const { mcpBaseUrl } = await import('./mcp-http')
  assert.equal(mcpBaseUrl(request('https://evil.example/api/mcp')), 'https://getoverlay.io')
  assert.equal(mcpBaseUrl(request('https://getoverlay.io.evil.example/api/mcp')), 'https://getoverlay.io')
  assert.equal(mcpBaseUrl(request('https://www.getoverlay.io/api/mcp', 'evil.example')), 'https://getoverlay.io')
  assert.equal(mcpBaseUrl(), 'https://getoverlay.io')
})
