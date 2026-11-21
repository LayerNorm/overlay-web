import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

// The configured app URL is the apex; its www twin is also accepted as the app's own host.
process.env.NEXT_PUBLIC_APP_URL = 'https://overlay.works'
process.env.NODE_ENV = 'production'

const request = (url: string, forwardedHost?: string) => ({
  url,
  headers: new Headers(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
})

test('advertised URLs follow the host the client called, for the app\'s own host and its www twin', async () => {
  const { mcpBaseUrl } = await import('./mcp-http')
  assert.equal(mcpBaseUrl(request('https://www.overlay.works/api/mcp')), 'https://www.overlay.works')
  assert.equal(mcpBaseUrl(request('https://overlay.works/api/mcp')), 'https://overlay.works')
  assert.equal(mcpBaseUrl(request('http://localhost:3000/api/mcp', 'www.overlay.works')), 'https://www.overlay.works')
})

test('a host that is not the app\'s own cannot choose the advertised URLs', async () => {
  const { mcpBaseUrl } = await import('./mcp-http')
  assert.equal(mcpBaseUrl(request('https://evil.example/api/mcp')), 'https://overlay.works')
  assert.equal(mcpBaseUrl(request('https://overlay.works.evil.example/api/mcp')), 'https://overlay.works')
  assert.equal(mcpBaseUrl(request('https://overlay.works/api/mcp', 'evil.example')), 'https://overlay.works')
  assert.equal(mcpBaseUrl(), 'https://overlay.works')
})
