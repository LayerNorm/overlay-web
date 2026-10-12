import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import type { AgentProfileBundle } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentProfileService } from './AgentProfileService'
import type { AgentProfileRecord, AgentProfileRepository, StagedProfileInput } from './AgentProfileRepository'

function memory() {
  const profiles: Array<AgentProfileRecord & { codeHash?: string; chunks?: string[] }> = []
  const secrets: Array<{ agentId: string; name: string; credentialRef: string; updatedAt: number }> = []
  const repository: AgentProfileRepository = {
    async createImport(a) {
      const id = `p${profiles.length + 1}`
      profiles.push({ id, workspaceId: a.workspaceId, agentId: a.agentId, userId: a.userId, harness: a.harness, status: 'awaiting_upload', version: 0, hooksEnabled: false, createdAt: a.now, codeHash: a.codeHash, codeExpiresAt: a.codeExpiresAt } as never)
      return id
    },
    async stageByCode(a: { codeHash: string; harness: string } & StagedProfileInput) {
      const row = profiles.find((p) => p.codeHash === a.codeHash && p.status === 'awaiting_upload' && p.harness === a.harness)
      if (!row) return null
      Object.assign(row, { status: 'staged', version: profiles.filter((p) => p.agentId === row.agentId && p.status !== 'awaiting_upload').length + 1, summary: a.summary, meta: a.meta, chunks: a.chunks, codeHash: undefined })
      return { profileId: row.id, agentId: row.agentId, workspaceId: row.workspaceId }
    },
    async get(id) { return profiles.find((p) => p.id === id) ?? null },
    async listByAgent(agentId) { return profiles.filter((p) => p.agentId === agentId && p.status !== 'awaiting_upload' && p.status !== 'discarded') },
    async readChunks(id) { return profiles.find((p) => p.id === id)?.chunks ?? [] },
    async activate({ profileId }) {
      const row = profiles.find((p) => p.id === profileId)!
      for (const p of profiles) if (p.agentId === row.agentId && p.status === 'active') p.status = 'superseded'
      row.status = 'active'
      return true
    },
    async setHooksEnabled({ profileId, enabled }) { profiles.find((p) => p.id === profileId)!.hooksEnabled = enabled; return true },
    async discard(id) { const row = profiles.find((p) => p.id === id)!; if (row.status !== 'staged') return false; row.status = 'discarded'; return true },
    async deleteAllForAgent(agentId) {
      const refs = secrets.filter((s) => s.agentId === agentId).map((s) => s.credentialRef)
      return { profiles: profiles.filter((p) => p.agentId === agentId).length, secretRefs: refs }
    },
    async setSecret(a) { secrets.push({ agentId: a.agentId, name: a.name, credentialRef: a.credentialRef, updatedAt: a.now }); return null },
    async listSecretNames(agentId) { return secrets.filter((s) => s.agentId === agentId).map((s) => ({ name: s.name, updatedAt: s.updatedAt })) },
    async listSecretRefs(agentId) { return secrets.filter((s) => s.agentId === agentId).map((s) => ({ name: s.name, credentialRef: s.credentialRef })) },
    async deleteSecret({ agentId, name }) { const i = secrets.findIndex((s) => s.agentId === agentId && s.name === name); return i < 0 ? null : secrets.splice(i, 1)[0]!.credentialRef },
  }
  return { repository, profiles }
}

function setup(options: { editable?: boolean } = {}) {
  const { repository, profiles } = memory()
  const vault = new Map<string, string>()
  const applied: Array<{ version: number; hooksEnabled: boolean; bundle: AgentProfileBundle }> = []
  const service = new AgentProfileService({
    repository,
    agents: { requireEditable: async () => { if (options.editable === false) throw new Error('not allowed') } },
    store: {
      write: async ({ apiKey }) => { const ref = `ref${vault.size + 1}`; vault.set(ref, apiKey); return ref },
      read: async (ref) => vault.get(ref) ?? null,
      delete: async (ref) => { vault.delete(ref) },
    },
    apply: async (a) => { applied.push({ version: a.version, hooksEnabled: a.hooksEnabled, bundle: a.bundle }) },
    audit: { record: async () => undefined } as never,
  })
  return { service, profiles, vault, applied }
}

const who = { actorUserId: 'u1', workspaceId: 'w1', agentId: 'a1' }
const upload = (files: Array<{ path: string; content: string }>, extra: Record<string, unknown> = {}) =>
  gzipSync(Buffer.from(JSON.stringify({ harness: 'claude-code', files, ...extra })))

async function importOnce(service: AgentProfileService, files: Array<{ path: string; content: string }>, extra: Record<string, unknown> = {}) {
  const issued = await service.createImportCode({ ...who, harness: 'claude-code', serverUrl: 'https://x.test/' })
  const { profileId } = await service.receiveUpload({ code: issued.code, body: upload(files, extra) })
  return { issued, profileId }
}

test('an import code builds the command, and a code works exactly once', async () => {
  const { service } = setup()
  const issued = await service.createImportCode({ ...who, harness: 'claude-code', serverUrl: 'https://x.test/' })
  assert.match(issued.command, /overlay-agent-host export-config claude-code --server https:\/\/x\.test --code ovprof_/)
  await service.receiveUpload({ code: issued.code, body: upload([{ path: 'CLAUDE.md', content: 'hello' }]) })
  await assert.rejects(service.receiveUpload({ code: issued.code, body: upload([{ path: 'CLAUDE.md', content: 'hello' }]) }), /invalid, expired, or already used/)
  await assert.rejects(service.receiveUpload({ code: 'nope', body: upload([]) }), /not valid/)
})

test('credentials and secret values never reach storage; the server needs are named instead', async () => {
  const { service, profiles } = setup()
  const { profileId } = await importOnce(service, [
    { path: '.credentials.json', content: '{"token":"sk-ant-secret"}' },
    { path: 'CLAUDE.md', content: 'be kind' },
  ], { mcpServers: { github: { command: 'npx', args: ['gh'], env: { GITHUB_TOKEN: 'ghp_1234567890abcdefghijklmnop' } } } })
  const row = profiles.find((p) => p.id === profileId)!
  assert.ok(!JSON.stringify(row).includes('sk-ant-secret'))
  assert.ok(!(row.chunks ?? []).join('').includes('ghp_1234567890'))
  const state = await service.state(who)
  assert.deepEqual(state.secrets, [{ name: 'GITHUB_TOKEN', usedBy: 'github', set: false }])
})

test('apply makes a version active, a newer one supersedes it, and an earlier one can be restored', async () => {
  const { service, applied } = setup()
  const first = await importOnce(service, [{ path: 'CLAUDE.md', content: 'one' }])
  await service.apply({ ...who, profileId: first.profileId })
  const second = await importOnce(service, [{ path: 'CLAUDE.md', content: 'two' }])
  await service.apply({ ...who, profileId: second.profileId })
  await service.apply({ ...who, profileId: first.profileId })
  assert.deepEqual(applied.map((a) => a.bundle.files[0]?.content), ['one', 'two', 'one'])
  const state = await service.state(who)
  assert.equal(state.profiles.filter((p) => p.status === 'active').length, 1)
  await assert.rejects(service.apply({ ...who, profileId: first.profileId }), /Only a version waiting/)
})

test('hooks stay off until asked, and discarding only works before applying', async () => {
  const { service, applied } = setup()
  const { profileId } = await importOnce(service, [{ path: 'settings.json', content: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }) }])
  await service.apply({ ...who, profileId })
  assert.equal(applied[0]!.hooksEnabled, false)
  await service.setHooks({ ...who, profileId, enabled: true })
  assert.equal(applied[1]!.hooksEnabled, true)
  await assert.rejects(service.discard({ ...who, profileId }), /waiting for review/)
})

test('needed values are stored encrypted, listed by name only, handed to runs, and removed with the agent', async () => {
  const { service, vault } = setup()
  await assert.rejects(service.setSecret({ ...who, name: 'ANTHROPIC_API_KEY', value: 'x' }), /not allowed/)
  await assert.rejects(service.setSecret({ ...who, name: 'GITHUB_TOKEN', value: '  ' }), /Enter the value/)
  await service.setSecret({ ...who, name: 'GITHUB_TOKEN', value: 'ghp_value' })
  assert.deepEqual((await service.state(who)).secrets, [{ name: 'GITHUB_TOKEN', usedBy: '', set: true }])
  assert.ok(!JSON.stringify(await service.state(who)).includes('ghp_value'))
  assert.deepEqual(await service.envForAgent({ agentId: 'a1' }), { GITHUB_TOKEN: 'ghp_value' })
  await service.deleteForAgent('a1')
  assert.equal(vault.size, 0)
})

test('someone who cannot edit the agent can do nothing with its config', async () => {
  const { service } = setup({ editable: false })
  await assert.rejects(service.state(who), /not allowed/)
  await assert.rejects(service.createImportCode({ ...who, harness: 'codex', serverUrl: 'https://x.test' }), /not allowed/)
  await assert.rejects(service.setSecret({ ...who, name: 'GITHUB_TOKEN', value: 'v' }), /not allowed/)
})
