import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from './route'

const callback = (query: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://getoverlay.io/auth/composio/callback?${query}`, { headers }))

describe('connector callback', () => {
  it('renders a static page that notifies the original tab and closes itself', async () => {
    const response = callback('status=success&connected_account_id=ca_1')
    const html = await response.text()
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(html.includes('<h1>Connected</h1>'))
    assert.ok(html.includes('new BroadcastChannel("overlay-integrations")'))
    assert.ok(html.includes('localStorage.setItem("overlay:integrations-changed"'))
    assert.ok(html.includes('window.close()'))
    assert.ok(!html.includes('/_next/'))
  })

  it('stamps the request CSP nonce on its script', async () => {
    const html = await callback('status=success', { 'x-nonce': 'n0nce' }).text()
    assert.ok(html.includes('<script nonce="n0nce">'))
  })

  it('shows an escaped error, tells the original tab only that it failed, and stays open', async () => {
    const html = await callback('status=failed&error=' + encodeURIComponent('<img src=x onerror=alert(1)>')).text()
    assert.ok(html.includes('<h1>Connection failed</h1>'))
    assert.ok(html.includes('&#60;img src=x onerror=alert(1)&#62;'))
    assert.ok(!html.includes('<img'))
    const script = html.slice(html.indexOf('<script'))
    assert.ok(script.includes("postMessage({type:'failed'})"))
    assert.ok(script.includes('localStorage.setItem("overlay:integrations-failed"'))
    assert.ok(!script.includes('onerror'))
    assert.ok(!html.includes('window.close()'))
    assert.ok(!html.includes('overlay:integrations-changed'))
  })
})
