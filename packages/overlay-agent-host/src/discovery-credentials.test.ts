import assert from 'node:assert/strict'
import {createHash, generateKeyPairSync, verify} from 'node:crypto'
import {createServer} from 'node:http'
import test from 'node:test'
import {canonicalHostRequestProof} from '@layernorm/overlay-agent-bridge-protocol'
import {HttpAgentControlPlaneClient} from './transport'

test('catalog delivery signs its exact adapter request and keeps provider secrets out of the request', async () => {
  const keys = generateKeyPairSync('ed25519'), credential = 'environment-only-test-credential'
  const observed: Array<{body: string; pathname: string; verified: boolean}> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8'), pathname = request.url ?? ''
    const canonical = canonicalHostRequestProof({method: request.method ?? '', pathname,
      timestamp: String(request.headers['x-overlay-agent-timestamp']), nonce: String(request.headers['x-overlay-agent-nonce']),
      tokenSha256: createHash('sha256').update(credential).digest('hex'), bodySha256: createHash('sha256').update(body).digest('hex')})
    observed.push({body, pathname, verified: verify(null, Buffer.from(canonical), keys.publicKey, Buffer.from(String(request.headers['x-overlay-agent-signature']), 'base64url'))})
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({protocolVersion: 1, env: {CLAUDE_CODE_OAUTH_TOKEN: 'probe-only-test-token'}}))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Expected HTTP listener')
    const client = new HttpAgentControlPlaneClient({baseUrl: `http://127.0.0.1:${address.port}/api/v1/agent-environments/owned`, environmentId: 'owned', credential,
      privateKey: keys.privateKey.export({format: 'pem', type: 'pkcs8'}).toString()})
    assert.deepEqual(await client.fetchDiscoveryCredentials('claude-code'), {CLAUDE_CODE_OAUTH_TOKEN: 'probe-only-test-token'})
    assert.deepEqual(observed, [{body: JSON.stringify({protocolVersion: 1, adapterId: 'claude-code'}), pathname: '/api/v1/agent-environments/owned/run-credentials', verified: true}])
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))}
})
