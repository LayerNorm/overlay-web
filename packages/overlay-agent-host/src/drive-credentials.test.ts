import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { canonicalHostRequestProof, type EnvironmentCredentialResponse } from '@layernorm/overlay-agent-bridge-protocol'
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

test('concurrent filesystem refreshes share a device-signed rotation and retain the new method grant', async () => {
  const keys = generateKeyPairSync('ed25519'), original = 'old-environment-token-'.repeat(3), next = 'new-environment-token-'.repeat(3)
  const rotated: EnvironmentCredentialResponse = { protocolVersion: 1, environmentId: 'environment', workspaceId: 'workspace',
    audience: 'overlay-agent-control-plane', token: next, expiresAt: Date.now() + 3600000,
    methods: ['agent:credentials:refresh', 'agent:heartbeat', 'agent:drive-credentials'],
    filesystemGrant: { mode: 'selected_roots', roots: ['/home/user/workspace', '/home/user/drive'] } }
  const observations: { valid: boolean; token: string; path: string }[] = []
  const changes: Array<Pick<EnvironmentCredentialResponse, 'token' | 'expiresAt' | 'filesystemGrant' | 'methods'>> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const path = request.url ?? '', body = Buffer.concat(chunks).toString('utf8')
    const token = path.endsWith('/credentials/refresh') ? original : next
    const proof = canonicalHostRequestProof({ method: request.method ?? 'GET', pathname: path,
      timestamp: String(request.headers['x-overlay-agent-timestamp']), nonce: String(request.headers['x-overlay-agent-nonce']),
      tokenSha256: createHash('sha256').update(token).digest('hex'), bodySha256: createHash('sha256').update(body).digest('hex') })
    observations.push({ path, token: String(request.headers.authorization),
      valid: verify(null, Buffer.from(proof), keys.publicKey, Buffer.from(String(request.headers['x-overlay-agent-signature']), 'base64url')) })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(path.endsWith('/credentials/refresh') ? rotated : { ok: true }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Expected HTTP listener')
    const client = new HttpAgentControlPlaneClient({ baseUrl: `http://127.0.0.1:${address.port}/api/v1/agent-environments/environment`,
      environmentId: 'environment', credential: original, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      onCredentialRotated: value => { changes.push(value) } })
    const grants = await Promise.all([client.refreshFilesystemGrant(), client.refreshFilesystemGrant()])
    assert.deepEqual(grants, [rotated.filesystemGrant, rotated.filesystemGrant])
    await client.heartbeat()
    assert.equal(observations.length, 2)
    assert.equal(observations.every(item => item.valid), true)
    assert.equal(observations[0]?.token, `Bearer ${original}`)
    assert.equal(observations[1]?.token, `Bearer ${next}`)
    assert.deepEqual(changes, [{ token: next, expiresAt: rotated.expiresAt, filesystemGrant: rotated.filesystemGrant, methods: rotated.methods }])
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

test('a rotation for another environment cannot replace the host credential or filesystem policy', async () => {
  const original = 'original-environment-token-'.repeat(3)
  let changes = 0, heartbeatToken = ''
  const client = new HttpAgentControlPlaneClient({ baseUrl: 'https://preview.invalid/api/v1/agent-environments/environment',
    environmentId: 'environment', credential: original, onCredentialRotated: () => { changes++ }, fetch: async (input, init) => {
      if (String(input).endsWith('/credentials/refresh')) return Response.json({ protocolVersion: 1, workspaceId: 'workspace',
        environmentId: 'foreign', audience: 'overlay-agent-control-plane', methods: ['agent:heartbeat'], token: 'foreign-token-'.repeat(4),
        expiresAt: Date.now() + 3600000, filesystemGrant: { mode: 'all_user_files' } })
      heartbeatToken = new Headers(init?.headers).get('authorization') ?? ''
      return Response.json({ ok: true })
    } })
  await assert.rejects(client.refreshFilesystemGrant(), /scope does not match/)
  await client.heartbeat()
  assert.equal(changes, 0)
  assert.equal(heartbeatToken, `Bearer ${original}`)
})
