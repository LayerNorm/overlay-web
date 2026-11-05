import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeDeploymentPolicyResponse, resolveNativeDeploymentPolicy } from './native-deployment-policy'

const secret = 'fixture-service-secret'
const challenge = '00000000-0000-4000-8000-000000000001'
const snapshot = {
  version: 1 as const, backendUrl: 'https://fixture.convex.cloud', revision: 'a'.repeat(64),
  features: { files: false, skills: true },
  rollout: { stage: 'off' as const, internalWorkspaceIds: '', invitedWorkspaceIds: '' },
}
const request = (key?: string, nonce = challenge) => new Request(`https://app.example.test/api/auth/convex-policy?challenge=${nonce}`, {
  headers: { ...(key ? { 'x-internal-api-secret': key } : {}), Cookie: 'overlay_session=fixture' },
})

test('session cookies cannot publish policy and only the exact service key obtains a no-store safe response', async () => {
  let calls = 0
  const resolve = async () => { calls++; return { ...snapshot, secretValue: 'do-not-return' } }
  for (const key of [undefined, 'wrong-key']) {
    assert.equal((await nativeDeploymentPolicyResponse(request(key), { secret, resolve })).status, 401)
  }
  assert.equal(calls, 0)
  const response = await nativeDeploymentPolicyResponse(request(secret), { secret, resolve, now: () => 1000 })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  const body = await response.json()
  assert.deepEqual(body, { challenge, issuedAt: 1000, snapshot })
  assert.equal(JSON.stringify(body).includes('do-not-return'), false)
})

test('invalid nonce and unavailable configuration fail closed without leaking diagnostic values', async () => {
  const resolve = async () => { throw new Error('sensitive-config-value') }
  assert.equal((await nativeDeploymentPolicyResponse(request(secret, 'invalid'), { secret, resolve })).status, 400)
  const response = await nativeDeploymentPolicyResponse(request(secret), { secret, resolve })
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes('sensitive-config-value'), false)
})

test('policy follows fresh file, remote and environment precedence instead of Convex-side defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-policy-test-'))
  try {
    const configFilePath = join(dir, 'config.json')
    await writeFile(configFilePath, JSON.stringify({ features: { files: false, skills: false, mcpServers: false } }))
    let remoteFiles = true
    const options = {
      configFilePath,
      remoteConfigUrl: 'https://config.example.test/runtime',
      fetcher: (async () => Response.json({ features: { files: remoteFiles, skills: true } })) as typeof fetch,
      env: {
        OVERLAY_DEPLOYMENT_ENV: 'test',
        NEXT_PUBLIC_CONVEX_URL: snapshot.backendUrl,
        OVERLAY_FEATURE_SKILLS: 'false',
        OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED: 'true',
        OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE: 'invited',
        OVERLAY_CONNECTED_AGENTS_INVITED_WORKSPACE_IDS: 'invited-fixture',
      },
    }
    const first = await resolveNativeDeploymentPolicy(options)
    assert.equal(first.features.files, true)
    assert.equal(first.features.skills, false)
    assert.equal(first.features.mcpServers, false)
    assert.equal(first.features.workspaceHandles, true)
    assert.equal(first.rollout.invitedWorkspaceIds, 'invited-fixture')
    remoteFiles = false
    const second = await resolveNativeDeploymentPolicy(options)
    assert.equal(second.features.files, false)
    assert.notEqual(first.revision, second.revision)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
