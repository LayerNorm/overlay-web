import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createPublicKey, verify } from 'node:crypto'
import test from 'node:test'
import { canonicalEnrollmentProof, canonicalHostRequestProof, hostCapabilitiesSchema, type HostCapabilities } from '@layernorm/overlay-agent-bridge-protocol'
import { loadStoredConnection } from './connection'
import { loadOrCreateDeviceKeyPair } from './device-key'
import { diagnoseHost } from './doctor'
import { connectAgentHost } from './enrollment'
import { LocalToolExecutor } from './local-tools'
import { redact } from './logger'
import { AgentHostRuntime } from './runtime'
import { HttpAgentControlPlaneClient, type AgentControlPlaneClient } from './transport'

const localTools = { version: 1 as const, os: 'darwin' as const, features: ['exec' as const, 'files' as const], homeDirectory: '/Users/dev' }

test('device keys persist privately and logs redact credential fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-key-'))
  try {
    const first = await loadOrCreateDeviceKeyPair(directory)
    const second = await loadOrCreateDeviceKeyPair(directory)
    assert.deepEqual(first, second)
    const keyPath = join(directory, 'keys', 'device-private.pem')
    await assertPrivateStateFile(keyPath)
    assert.match(await readFile(keyPath, 'utf8'), /PRIVATE KEY/)
    assert.deepEqual(redact({ token: 'secret', nested: { password: 'secret', safe: 'value' } }), { token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'value' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('doctor validates the credential, state, device key and local tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-doctor-'))
  try {
    const checks = await diagnoseHost({
      environmentId: 'environment-1', workspaceId: 'workspace-1', controlPlaneUrl: 'https://overlay.invalid/',
      credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL', credential: 'not-logged', stateDirectory: directory,
      filesystem: { mode: 'all_user_files' }, localTools: true,
    }, new LocalToolExecutor({ stateDirectory: directory, grant: () => ({ mode: 'all_user_files' }), platform: 'linux' }))
    assert.equal(checks.every((check) => check.ok), true)
    assert.deepEqual(checks.map((check) => check.name), ['credential', 'state-directory', 'device-key', 'local-tools'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('connect enrolls a local-tools device, proves key possession, and stores only the short-lived credential privately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-connect-'))
  let publicKey = ''
  let enrolledCapabilities: HostCapabilities | undefined
  let credentialAttempts = 0
  try {
    const connection = await connectAgentHost({
      code: 'single-use-enrollment-code-1234',
      serverUrl: 'https://overlay.example',
      stateDirectory: directory,
      waitTimeoutMs: 5_000,
      localTools,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/enroll')) {
          const body = JSON.parse(String(init?.body)) as { publicKey: string; capabilities: HostCapabilities }
          publicKey = body.publicKey
          enrolledCapabilities = hostCapabilitiesSchema.parse(body.capabilities)
          return Response.json({
            protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1',
            verificationPhrase: 'amber-river-sage', proofChallenge: 'proof-challenge-with-enough-entropy-1234',
            proofChallengeExpiresAt: Date.now() + 60_000,
          }, { status: 201 })
        }
        credentialAttempts += 1
        const body = JSON.parse(String(init?.body)) as { proofChallenge: string; signature: string }
        assert.equal(verify(null, Buffer.from(canonicalEnrollmentProof('environment-1', body.proofChallenge)),
          createPublicKey(publicKey), Buffer.from(body.signature, 'base64url')), true)
        if (credentialAttempts === 1) return Response.json({ code: 'environment_pending' }, { status: 425 })
        return Response.json({
          protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1',
          audience: 'overlay-agent-control-plane', methods: ['agent:commands:poll'],
          token: 'short-lived-environment-credential-123456789', expiresAt: Date.now() + 60_000,
          filesystemGrant: { mode: 'selected_roots', roots: ['/workspace/project'] },
        }, { status: 201 })
      },
    })
    assert.equal(connection.environmentId, 'environment-1')
    assert.deepEqual(enrolledCapabilities?.localTools, localTools)
    assert.equal((await loadStoredConnection(directory))?.token, 'short-lived-environment-credential-123456789')
    await assertPrivateStateFile(join(directory, 'connection.json'))
    assert.equal((await readFile(join(directory, 'connection.json'), 'utf8')).includes('single-use-enrollment-code'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('HTTP transport signs the exact method, path, body and credential hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-signed-http-'))
  try {
    const keys = await loadOrCreateDeviceKeyPair(directory)
    const credential = 'environment-credential-with-enough-entropy'
    const seen: string[] = []
    const client = new HttpAgentControlPlaneClient({
      baseUrl: 'https://overlay.example/api/v1/agent-environments/environment-1/',
      environmentId: 'environment-1',
      credential,
      privateKey: keys.privateKey,
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const canonical = canonicalHostRequestProof({
          method: init?.method ?? 'GET', pathname: `${url.pathname}${url.search}`,
          timestamp: headers.get('x-overlay-agent-timestamp')!, nonce: headers.get('x-overlay-agent-nonce')!,
          bodySha256: createHash('sha256').update(typeof init?.body === 'string' ? init.body : '').digest('hex'),
          tokenSha256: createHash('sha256').update(credential).digest('hex'),
        })
        assert.equal(verify(null, Buffer.from(canonical), createPublicKey(keys.publicKey), Buffer.from(headers.get('x-overlay-agent-signature')!, 'base64url')), true)
        seen.push(`${init?.method} ${url.pathname}`)
        return Response.json(url.pathname.endsWith('/local-tool-calls') ? { protocolVersion: 1, calls: [] } : { protocolVersion: 1, accepted: true })
      },
    })
    await client.pollLocalToolCalls({ waitMs: 1_000 })
    await client.submitLocalToolResult({ protocolVersion: 1, callId: 'call-1', outcome: { ok: true, result: {} } })
    await client.heartbeat()
    assert.deepEqual(seen, [
      'GET /api/v1/agent-environments/environment-1/local-tool-calls',
      'POST /api/v1/agent-environments/environment-1/local-tool-calls/call-1/result',
      'POST /api/v1/agent-environments/environment-1/heartbeat',
    ])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the runtime registers its local tools, stays online and stops cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-runtime-'))
  const calls: string[] = []
  const controller = new AbortController()
  const controlPlane: AgentControlPlaneClient = {
    async heartbeat() { calls.push('heartbeat') },
    async updateCapabilities(capabilities) { calls.push(`capabilities:${hostCapabilitiesSchema.parse(capabilities).localTools?.features.join(',')}`) },
    async pollLocalToolCalls({ signal }) {
      calls.push('poll')
      controller.abort()
      if (signal?.aborted) throw new Error('aborted')
      return { calls: [] }
    },
    async submitLocalToolResult() {},
  }
  try {
    await new AgentHostRuntime({
      environmentId: 'environment-1', workspaceId: 'workspace-1', filesystem: { mode: 'all_user_files' }, controlPlane,
      localTools: new LocalToolExecutor({ stateDirectory: directory, grant: () => ({ mode: 'all_user_files' }), platform: 'linux' }),
      logger: { info() {}, warn() {}, error() {} } as never,
    }).run(controller.signal)
    assert.deepEqual(calls.slice(0, 3), ['capabilities:exec,files,terminal' + (calls[0]?.includes('browser') ? ',browser' : ''), 'heartbeat', 'poll'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function assertPrivateStateFile(path: string): Promise<void> {
  const mode = (await stat(path)).mode & 0o777
  if (process.platform === 'win32') { assert.equal(mode, 0o666); return }
  assert.equal(mode, 0o600)
}
