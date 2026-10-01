import 'server-only'

import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

import { mintAgentGatewayToken, verifyAgentGatewayToken } from './token'

const SECRET_ENV = 'OVERLAY_AGENT_GATEWAY_SECRET'
const FALLBACK_ENV = 'INTERNAL_API_SECRET'

function withSecret(secret: string, fn: () => void) {
  const priorSecret = process.env[SECRET_ENV]
  const priorFallback = process.env[FALLBACK_ENV]
  process.env[SECRET_ENV] = secret
  delete process.env[FALLBACK_ENV]
  try {
    fn()
  } finally {
    if (priorSecret === undefined) delete process.env[SECRET_ENV]
    else process.env[SECRET_ENV] = priorSecret
    if (priorFallback === undefined) delete process.env[FALLBACK_ENV]
    else process.env[FALLBACK_ENV] = priorFallback
  }
}

test('minted tokens verify and carry the billing scope', () => {
  withSecret('test-gateway-secret', () => {
    const token = mintAgentGatewayToken({ userId: 'user-1', workspaceId: 'ws-1', agentId: 'agent-1' })
    assert.ok(token)
    const claims = verifyAgentGatewayToken(token)
    assert.equal(claims?.userId, 'user-1')
    assert.equal(claims?.workspaceId, 'ws-1')
    assert.equal(claims?.agentId, 'agent-1')
  })
})

test('agentless claims omit agentId; expiry is honored', () => {
  withSecret('test-gateway-secret', () => {
    const token = mintAgentGatewayToken({ userId: 'user-1', workspaceId: 'ws-1' })
    assert.equal(verifyAgentGatewayToken(token)?.agentId, undefined)
    // Sign a well-formed but already-expired payload directly.
    const payload = Buffer.from(JSON.stringify({ v: 1, uid: 'u', wid: 'w', exp: Date.now() - 1 }))
      .toString('base64url')
    const signature = createHmac('sha256', 'test-gateway-secret')
      .update(`overlay-agent-gateway:v1.${payload}`).digest('base64url')
    assert.equal(verifyAgentGatewayToken(`${payload}.${signature}`), null)
  })
})

test('tampered payloads and wrong-secret tokens are rejected', () => {
  withSecret('test-gateway-secret', () => {
    const token = mintAgentGatewayToken({ userId: 'user-1', workspaceId: 'ws-1' })!
    const [payload, signature] = token.split('.')
    // Forged payload with a real signature prefix must fail verification.
    const forgedPayload = Buffer.from(JSON.stringify({
      v: 1, uid: 'attacker', wid: 'ws-1', exp: Date.now() + 60_000,
    })).toString('base64url')
    assert.equal(verifyAgentGatewayToken(`${forgedPayload}.${signature}`), null)
    assert.equal(verifyAgentGatewayToken(`${payload}.AAAA`), null)
    assert.equal(verifyAgentGatewayToken('not-a-token'), null)
    assert.equal(verifyAgentGatewayToken(''), null)
  })
  withSecret('different-secret', () => {
    const token = mintAgentGatewayToken({ userId: 'u', workspaceId: 'w' })
    withSecret('test-gateway-secret', () => {
      assert.equal(verifyAgentGatewayToken(token!), null)
    })
  })
})
