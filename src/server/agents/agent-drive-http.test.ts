import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { handleAgentDriveRequest } from './agent-drive-http'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'

const token = 'ovdrive_synthetic_transport_fixture'
const mac = 'a'.repeat(43)
const entry = { fileId: 'file', path: 'folder/report.md', updatedAt: 1, kind: 'file' as const, hydration: 'ready' as const, sizeBytes: 3, sha256: 'b'.repeat(64) }
const request = (body: unknown, extraHeaders: Record<string, string> = {}) => new Request('https://preview.invalid/api/agent-drive', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
})
function fixture() {
  let calls = 0
  const dependencies = { enabled: () => true, limit: async () => null as Response | null,
    service: () => ({
      async manifest(value: string | null) { calls++; assert.equal(value, token); return { entries: [{ fileId: 'folder', path: 'folder', updatedAt: 1, kind: 'folder' as const }, { ...entry, downloadMac: mac }] } },
      async download(value: string | null) { calls++; assert.equal(value, token); return new Uint8Array([1, 2, 3]) },
    }),
  }
  return { dependencies, get calls() { return calls } }
}

test('drive stays disabled by default and cookies or URL credentials cannot authorize machine reads', async () => {
  assert.equal(DEFAULT_OVERLAY_RUNTIME_CONFIG.features.connectedAgentDrive, false)
  const f = fixture()
  assert.equal((await handleAgentDriveRequest(request({ action: 'manifest' }), { ...f.dependencies, enabled: () => false })).status, 404)
  const cookieOnly = new Request(`https://preview.invalid/api/agent-drive?token=${token}`, { method: 'POST', headers: { cookie: 'overlay_session=fixture', 'content-type': 'application/json' }, body: '{"action":"manifest"}' })
  const denied = await handleAgentDriveRequest(cookieOnly, f.dependencies)
  assert.equal(denied.status, 401)
  assert.equal(denied.headers.get('www-authenticate'), 'Bearer')
  assert.equal(f.calls, 0)
})

test('manifest is framed, private and complete without exposing credentials or source references', async () => {
  const f = fixture()
  const response = await handleAgentDriveRequest(request({ action: 'manifest' }), f.dependencies)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type')!, /application\/x-ndjson/)
  assert.match(response.headers.get('cache-control')!, /no-store/)
  const text = await response.text()
  const frames = text.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(frames[0], { type: 'manifest', version: 1 })
  assert.deepEqual(frames.at(-1), { type: 'complete', entries: 2 })
  assert.equal(frames[2].entry.downloadMac, mac)
  assert.equal(text.includes(token), false)
  assert.equal(text.includes('storageId'), false)
})

test('malformed, extra-scope and oversized bodies fail before accessing the service', async () => {
  const f = fixture()
  assert.equal((await handleAgentDriveRequest(request({ action: 'manifest', scope: 'workspace' }), f.dependencies)).status, 400)
  assert.equal((await handleAgentDriveRequest(request({ action: 'manifest' }, { 'content-type': 'text/plain' }), f.dependencies)).status, 415)
  assert.equal((await handleAgentDriveRequest(request({ action: 'manifest' }, { 'content-length': '40000' }), f.dependencies)).status, 413)
  const invalid = new Request('https://preview.invalid/api/agent-drive', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: new Uint8Array([255]) })
  assert.equal((await handleAgentDriveRequest(invalid, f.dependencies)).status, 400)
  const oversized = new Request('https://preview.invalid/api/agent-drive', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: ' '.repeat(40000) })
  assert.equal((await handleAgentDriveRequest(oversized, f.dependencies)).status, 413)
  assert.equal(f.calls, 0)
})

test('bounded ranges reconstruct a large verified file exactly and reject invalid offsets', async () => {
  const f = fixture()
  const bytes = new Uint8Array(5 * 1024 * 1024 + 17).map((_, i) => i % 251)
  const chunks: Uint8Array[] = []
  let downloads = 0
  f.dependencies.service = () => ({ ...fixture().dependencies.service(), async download() { downloads++; return bytes } })
  for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
    const response = await handleAgentDriveRequest(request({ action: 'download', entry, downloadMac: mac, offset, length: 1024 * 1024 }), f.dependencies)
    assert.equal(response.status, 206)
    const chunk = new Uint8Array(await response.arrayBuffer())
    assert.ok(chunk.length <= 1024 * 1024)
    assert.equal(response.headers.get('x-overlay-drive-size'), String(bytes.length))
    assert.match(response.headers.get('content-range')!, new RegExp(`^bytes ${offset}-`))
    chunks.push(chunk)
  }
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), createHash('sha256').update(bytes).digest('hex'))
  assert.equal(downloads, 6)
  assert.equal((await handleAgentDriveRequest(request({ action: 'download', entry, downloadMac: mac, offset: bytes.length, length: 1 }), f.dependencies)).status, 416)
  assert.equal((await handleAgentDriveRequest(request({ action: 'download', entry, downloadMac: mac, offset: 0, length: 2 * 1024 * 1024 }), f.dependencies)).status, 400)
})

test('revocation and changed sources are explicit, unknown server errors are sanitized, and rate limits preserve cooldowns', async () => {
  for (const [code, status] of [['DRIVE_UNAUTHORIZED', 401], ['DRIVE_RUN_UNAVAILABLE', 403], ['DRIVE_SOURCE_CHANGED', 409], ['DRIVE_SNAPSHOT_UNAVAILABLE', 503]] as const) {
    const f = fixture()
    f.dependencies.service = () => ({ ...fixture().dependencies.service(), async manifest() { throw Error(code) } })
    assert.equal((await handleAgentDriveRequest(request({ action: 'manifest' }), f.dependencies)).status, status)
  }
  const f = fixture()
  f.dependencies.service = () => ({ ...fixture().dependencies.service(), async manifest() { throw Error('private secret and object path') } })
  const failure = await handleAgentDriveRequest(request({ action: 'manifest' }), f.dependencies)
  assert.equal(failure.status, 500)
  assert.deepEqual(await failure.json(), { error: 'DRIVE_REQUEST_FAILED' })
  f.dependencies.limit = async () => Response.json({ retryAfterSeconds: 12 }, { status: 429, headers: { 'retry-after': '12' } })
  const limited = await handleAgentDriveRequest(request({ action: 'manifest' }), f.dependencies)
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '12')
})

test('HTTP transport composes with real token and manifest verification, including changed bytes and revocation', async () => {
  const { createAgentDriveTokens } = await import('./agent-drive-token')
  const { AgentDriveManifestService } = await import('./AgentDriveManifestService')
  const { AgentDriveMaterializer } = await import('./AgentDriveMaterializer')
  const secret = 'http-drive-integration-fixture-at-least-32-bytes'
  const tokens = createAgentDriveTokens({ secret })
  const signed = tokens.mint({ actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 's', scope: { kind: 'personal', workspaceId: 'w', ownerUserId: 'u' } }, Date.now() + 300000)
  let active = true
  const row = { _id: 'file', name: 'report.md', userId: 'u', workspaceId: 'w', type: 'file', kind: 'note', content: 'original bytes', createdAt: 1, updatedAt: 2 }
  const service = new AgentDriveManifestService({ secret, verifyToken: token => tokens.verify(token),
    repository: () => ({
      async authorize() { if (!active) throw Error('DRIVE_RUN_UNAVAILABLE') },
      async page() { return { rows: [row], scope: { kind: 'personal' as const, workspaceId: 'w', ownerUserId: 'u' }, viewer: { userId: 'u', role: 'member' as const }, nextCursor: null } },
      async file() { return row },
    }),
    materializer: () => new AgentDriveMaterializer({ async size() { throw Error('unexpected object') }, async read() { throw Error('unexpected object') } }),
  })
  const deps = { enabled: () => true, limit: async () => null, service: () => service }
  const invoke = (body: unknown, bearer = signed) => handleAgentDriveRequest(request(body, { authorization: `Bearer ${bearer}` }), deps)
  const manifest = await invoke({ action: 'manifest' })
  const frames = (await manifest.text()).trim().split('\n').map(line => JSON.parse(line))
  const { downloadMac, ...entry } = frames[1].entry
  const download = { action: 'download', entry, downloadMac, offset: 0, length: 1024 }
  assert.equal(await (await invoke(download)).text(), 'original bytes')
  assert.equal((await invoke({ action: 'manifest' }, 'ovdrive_forged')).status, 401)
  assert.equal((await invoke({ ...download, entry: { ...entry, path: 'forged.md' } })).status, 403)
  row.content = 'changed bytes!'
  assert.equal((await invoke(download)).status, 409)
  active = false
  assert.equal((await invoke(download)).status, 403)
  assert.equal((await invoke({ action: 'manifest' })).status, 403)
})
