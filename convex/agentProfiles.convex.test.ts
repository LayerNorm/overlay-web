import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-profiles-contract-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const query = (name: string) => makeFunctionReference<'query'>(`agents/profiles:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`agents/profiles:${name}`)
const identity = { serverSecret: secret, workspaceId: 'ws_1', agentId: 'agent_1', userId: 'user_1' }
const base = { ...identity, harness: 'claude-code' }
const staged = { summary: { files: 2 }, meta: { dropped: [] }, digest: 'd1', chunks: ['AAA', 'BBB'], now: 1_000 }

describe('Convex agent profiles', () => {
  test('every function rejects a wrong server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(query('listByAgentByServer'), { serverSecret: 'nope', agentId: 'a' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged, serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
  })

  test('a staged profile reads back its chunks in order, and activating it supersedes the one before', async () => {
    const convex = convexTest(schema, modules)
    const first = await convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged })
    expect((await convex.query(query('readChunksByServer'), { serverSecret: secret, profileId: first })).join('')).toBe('AAABBB')
    expect(await convex.mutation(mutation('activateByServer'), { serverSecret: secret, profileId: first, now: 2_000 })).toBe(true)
    const second = await convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged, digest: 'd2', now: 3_000 })
    await convex.mutation(mutation('activateByServer'), { serverSecret: secret, profileId: second, now: 4_000 })
    const listed = await convex.query(query('listByAgentByServer'), { serverSecret: secret, agentId: 'agent_1' })
    expect(listed.map((row) => [row.version, row.status])).toEqual([[2, 'active'], [1, 'superseded']])
    // Rolling back is activating the older version again.
    await convex.mutation(mutation('activateByServer'), { serverSecret: secret, profileId: first, now: 5_000 })
    expect((await convex.query(query('listByAgentByServer'), { serverSecret: secret, agentId: 'agent_1' })).map((row) => [row.version, row.status])).toEqual([[2, 'superseded'], [1, 'active']])
  })

  test('an upload code opens one slot once, expires, and only for its harness', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('createImportByServer'), { ...base, codeHash: 'hash-1', codeExpiresAt: 10_000, now: 1_000 })
    expect(await convex.mutation(mutation('stageByCodeServer'), { serverSecret: secret, codeHash: 'wrong', harness: 'claude-code', ...staged })).toBeNull()
    expect(await convex.mutation(mutation('stageByCodeServer'), { serverSecret: secret, codeHash: 'hash-1', harness: 'codex', ...staged })).toBeNull()
    expect(await convex.mutation(mutation('stageByCodeServer'), { serverSecret: secret, codeHash: 'hash-1', harness: 'claude-code', ...staged, now: 11_000 })).toBeNull()
    const ok = await convex.mutation(mutation('stageByCodeServer'), { serverSecret: secret, codeHash: 'hash-1', harness: 'claude-code', ...staged, now: 2_000 })
    expect(ok).toMatchObject({ agentId: 'agent_1', workspaceId: 'ws_1' })
    expect(await convex.mutation(mutation('stageByCodeServer'), { serverSecret: secret, codeHash: 'hash-1', harness: 'claude-code', ...staged, now: 2_001 })).toBeNull()
  })

  test('a new import replaces a pending one, and discarding removes its chunks', async () => {
    const convex = convexTest(schema, modules)
    const first = await convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged })
    const second = await convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged, digest: 'd2' })
    expect(await convex.query(query('readChunksByServer'), { serverSecret: secret, profileId: first })).toEqual([])
    expect(await convex.mutation(mutation('discardByServer'), { serverSecret: secret, profileId: second })).toBe(true)
    expect(await convex.query(query('listByAgentByServer'), { serverSecret: secret, agentId: 'agent_1' })).toEqual([])
  })

  test('secrets keep names for the page and vault references for the server, and replacing returns the old reference', async () => {
    const convex = convexTest(schema, modules)
    const args = { ...identity, name: 'GITHUB_TOKEN', now: 1_000 }
    expect(await convex.mutation(mutation('setSecretByServer'), { ...args, credentialRef: 'ref-1' })).toBeNull()
    expect(await convex.mutation(mutation('setSecretByServer'), { ...args, credentialRef: 'ref-2', now: 2_000 })).toBe('ref-1')
    expect(await convex.query(query('listSecretNamesByServer'), { serverSecret: secret, agentId: 'agent_1' })).toEqual([{ name: 'GITHUB_TOKEN', updatedAt: 2_000 }])
    expect(JSON.stringify(await convex.query(query('listSecretNamesByServer'), { serverSecret: secret, agentId: 'agent_1' }))).not.toContain('ref-')
    expect(await convex.query(query('listSecretRefsByServer'), { serverSecret: secret, agentId: 'agent_1' })).toEqual([{ name: 'GITHUB_TOKEN', credentialRef: 'ref-2' }])
    expect(await convex.mutation(mutation('deleteSecretByServer'), { serverSecret: secret, agentId: 'agent_1', name: 'GITHUB_TOKEN' })).toBe('ref-2')
  })

  test('deleting an agent removes its profiles and returns the secret references to delete from the vault', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('stageDirectByServer'), { ...base, ...staged })
    await convex.mutation(mutation('setSecretByServer'), { ...identity, name: 'X_TOKEN', credentialRef: 'ref-x', now: 1 })
    expect(await convex.mutation(mutation('deleteAllForAgentByServer'), { serverSecret: secret, agentId: 'agent_1' })).toEqual({ profiles: 1, secretRefs: ['ref-x'] })
    expect(await convex.query(query('listByAgentByServer'), { serverSecret: secret, agentId: 'agent_1' })).toEqual([])
  })
})
