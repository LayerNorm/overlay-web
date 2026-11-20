import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { NextRequest } from 'next/server'
import {
  INTEGRATIONS_ATTEMPT_SESSION_KEY,
  INTEGRATIONS_FAILED_STORAGE_KEY,
  INTEGRATIONS_STORAGE_KEY,
} from '@/shared/integrations/integrations-events'
import { GET } from './route'

const callback = (query: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://getoverlay.io/auth/composio/callback?${query}`, { headers }))

function callbackScript(html: string): string {
  const open = html.indexOf('<script')
  const start = html.indexOf('>', open) + 1
  const end = html.indexOf('</script>', start)
  assert.ok(open >= 0 && start > 0 && end > start)
  return html.slice(start, end)
}

function runCallbackScript(script: string, options: {
  attemptId?: string
  storageAvailable?: boolean
  broadcastChannelAvailable?: boolean
} = {}) {
  const sessionValues = new Map<string, string>()
  if (options.attemptId) sessionValues.set(INTEGRATIONS_ATTEMPT_SESSION_KEY, options.attemptId)
  const removedKeys: string[] = []
  const sessionStorage = {
    getItem(key: string) {
      if (options.storageAvailable === false) throw new Error('session storage unavailable')
      return sessionValues.get(key) ?? null
    },
    removeItem(key: string) {
      if (options.storageAvailable === false) throw new Error('session storage unavailable')
      removedKeys.push(key)
      sessionValues.delete(key)
    },
  }
  const channelNames: string[] = []
  const messages: unknown[] = []
  class MockBroadcastChannel {
    constructor(name: string) {
      channelNames.push(name)
    }

    postMessage(message: unknown) {
      messages.push(message)
    }

    close() {}
  }
  const localWrites: Array<{ key: string; value: string }> = []
  const timeoutDelays: number[] = []
  const windowState = { closed: false }

  runInNewContext(script, {
    BroadcastChannel: options.broadcastChannelAvailable === false ? undefined : MockBroadcastChannel,
    Date: { now: () => 123 },
    localStorage: { setItem: (key: string, value: string) => localWrites.push({ key, value }) },
    sessionStorage,
    setTimeout: (_callback: () => void, delay: number) => {
      timeoutDelays.push(delay)
      return timeoutDelays.length
    },
    window: { close: () => { windowState.closed = true } },
  })

  return { channelNames, localWrites, messages, removedKeys, sessionValues, timeoutDelays, windowState }
}

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
    assert.ok(script.includes('sessionStorage.getItem("overlay:integrations-attempt")'))
    assert.ok(script.includes("postMessage({type:'failed',attemptId:a})"))
    assert.ok(script.includes('if(a){'))
    assert.ok(script.includes('localStorage.setItem("overlay:integrations-failed"'))
    assert.ok(!script.includes('onerror'))
    assert.ok(!html.includes('window.close()'))
    assert.ok(!html.includes('overlay:integrations-changed'))
  })

  it('executes an attempt-scoped failure signal, consumes the key, and keeps the error out of cross-tab messages', async () => {
    const error = '<img src=x onerror=alert(1)>'
    const html = await callback('status=failed&error=' + encodeURIComponent(error)).text()
    const script = callbackScript(html)
    const result = runCallbackScript(script, { attemptId: 'attempt-a' })

    assert.ok(html.includes('&#60;img src=x onerror=alert(1)&#62;'))
    assert.ok(!html.includes('<img'))
    assert.equal(JSON.stringify(result.messages), JSON.stringify([{ type: 'failed', attemptId: 'attempt-a' }]))
    assert.deepEqual(result.localWrites, [{
      key: INTEGRATIONS_FAILED_STORAGE_KEY,
      value: JSON.stringify({ attemptId: 'attempt-a', at: 123 }),
    }])
    assert.deepEqual(result.removedKeys, [INTEGRATIONS_ATTEMPT_SESSION_KEY])
    assert.equal(result.sessionValues.has(INTEGRATIONS_ATTEMPT_SESSION_KEY), false)
    assert.ok(!script.includes(error))
    assert.ok(!JSON.stringify(result.messages).includes(error))
    assert.ok(!JSON.stringify(result.localWrites).includes(error))
    assert.equal(result.windowState.closed, false)
    assert.deepEqual(result.timeoutDelays, [])
  })

  it('does not signal failure when the attempt is absent or tab storage is unavailable', async () => {
    const script = callbackScript(await callback('status=failed&error=denied').text())
    const absent = runCallbackScript(script)
    const unavailable = runCallbackScript(script, { storageAvailable: false })

    for (const result of [absent, unavailable]) {
      assert.deepEqual(result.messages, [])
      assert.deepEqual(result.localWrites, [])
      assert.equal(result.windowState.closed, false)
      assert.deepEqual(result.timeoutDelays, [])
    }
  })

  it('uses the localStorage failure fallback when BroadcastChannel is unavailable', async () => {
    const script = callbackScript(await callback('status=failed').text())
    const result = runCallbackScript(script, { attemptId: 'attempt-a', broadcastChannelAvailable: false })

    assert.deepEqual(result.messages, [])
    assert.deepEqual(result.channelNames, [])
    assert.deepEqual(result.localWrites, [{
      key: INTEGRATIONS_FAILED_STORAGE_KEY,
      value: JSON.stringify({ attemptId: 'attempt-a', at: 123 }),
    }])
    assert.equal(result.windowState.closed, false)
  })

  it('preserves success notification and close scheduling', async () => {
    const script = callbackScript(await callback('status=success').text())
    const result = runCallbackScript(script, { attemptId: 'attempt-success' })

    assert.equal(JSON.stringify(result.messages), JSON.stringify([{ type: 'changed' }]))
    assert.deepEqual(result.localWrites, [{ key: INTEGRATIONS_STORAGE_KEY, value: '123' }])
    assert.deepEqual(result.removedKeys, [INTEGRATIONS_ATTEMPT_SESSION_KEY])
    assert.deepEqual(result.timeoutDelays, [600])
    assert.equal(result.windowState.closed, false)
  })
})
