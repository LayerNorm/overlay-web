import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { canonicalHostRequestProof } from '@layernorm/overlay-agent-bridge-protocol'
import { ControlPlaneRequestError, HttpAgentControlPlaneClient } from './transport'

test('drive issuance and renewal sign the exact run/session/fence over real HTTP without sending drive or storage secrets', async () => {
  const keys = generateKeyPairSync('ed25519')
  const credential = 'environment-credential-tests-only'
  const requests: { body: string; nonce: string; signatureValid: boolean; pathname: string }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    const nonce = String(request.headers['x-overlay-agent-nonce'])
    const canonical = canonicalHostRequestProof({ method: request.method ?? 'GET', pathname: request.url ?? '',
      timestamp: String(request.headers['x-overlay-agent-timestamp']), nonce,
      tokenSha256: createHash('sha256').update(credential).digest('hex'),
      bodySha256: createHash('sha256').update(body).digest('hex') })
    requests.push({ body, nonce, pathname: request.url ?? '', signatureValid: verify(null, Buffer.from(canonical), keys.publicKey,
      Buffer.from(String(request.headers['x-overlay-agent-signature']), 'base64url')) })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ protocolVersion: 1, token: 'ovdrive_' + 'a'.repeat(32) + '.' + 'b'.repeat(43),
      expiresAt: Date.now() + 100000, scope: { kind: 'personal', workspaceId: 'workspace', ownerUserId: 'owner' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Expected HTTP listener')
    const client = new HttpAgentControlPlaneClient({ baseUrl: `http://127.0.0.1:${address.port}/api/v1/agent-environments/environment`,
      environmentId: 'environment', credential, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() })
    const input = { runId: 'run', sessionId: 'session', execution: { attemptId: 'attempt', generation: 1 } }
    for (let i = 0; i < 2; i++) assert.equal((await client.fetchDriveCredentials(input)).scope.kind, 'personal')
    assert.equal(requests.length, 2)
    assert.notEqual(requests[0]?.nonce, requests[1]?.nonce)
    for (const request of requests) {
      assert.equal(request.signatureValid, true)
      assert.equal(request.pathname, '/api/v1/agent-environments/environment/drive-credentials')
      assert.deepEqual(JSON.parse(request.body), { ...input, protocolVersion: 1 })
      assert.equal(request.body.includes('ovdrive_'), false)
      assert.equal(request.body.includes('storage'), false)
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

test('drive credential refusals are surfaced without automatic retries or leaking the response secret', async () => {
  let calls = 0
  const client = new HttpAgentControlPlaneClient({ baseUrl: 'https://preview.invalid/api/v1/agent-environments/environment',
    environmentId: 'environment', credential: 'test-only', fetch: async () => {
      calls++
      return Response.json({ code: 'DRIVE_RUN_UNAVAILABLE', token: 'must-not-leak' }, { status: 403 })
    } })
  await assert.rejects(client.fetchDriveCredentials({ runId: 'run', sessionId: 'old' }), error => {
    assert.ok(error instanceof ControlPlaneRequestError)
    assert.equal(error.code, 'DRIVE_RUN_UNAVAILABLE')
    assert.equal(error.message.includes('must-not-leak'), false)
    return true
  })
  assert.equal(calls, 1)
})
