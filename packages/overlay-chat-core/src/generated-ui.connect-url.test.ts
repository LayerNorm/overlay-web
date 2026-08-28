import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGeneratedUiData } from './generated-ui'

function connector(connectUrl: unknown) {
  return normalizeGeneratedUiData({
    version: 1,
    kind: 'connector.connect',
    serviceName: 'Gmail',
    connectUrl,
  })
}

test('keeps http(s) connect URLs', () => {
  assert.equal(connector('https://accounts.google.com/o/oauth2/auth')?.kind, 'connector.connect')
  assert.equal(
    (connector('https://accounts.google.com/o/oauth2/auth') as { connectUrl?: string }).connectUrl,
    'https://accounts.google.com/o/oauth2/auth',
  )
})

test('drops javascript: connect URLs', () => {
  // Generated UI is model-authored, so this field is reachable via prompt
  // injection and lands in window.open.
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'not a url',
  ]) {
    const result = connector(hostile) as { connectUrl?: string } | null
    assert.ok(result, `card should still render for ${hostile}`)
    assert.equal(result.connectUrl, undefined, `connectUrl should be dropped for ${hostile}`)
  }
})

test('drops non-string connect URLs', () => {
  assert.equal((connector(42) as { connectUrl?: string }).connectUrl, undefined)
  assert.equal((connector(null) as { connectUrl?: string }).connectUrl, undefined)
})
