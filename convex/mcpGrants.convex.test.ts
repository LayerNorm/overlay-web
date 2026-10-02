import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'mcp-grants-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const query = (name: string) => makeFunctionReference<'query'>(`mcp/grants:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`mcp/grants:${name}`)

const base = { serverSecret: secret, userId: 'user_1', workspaceId: 'ws_1', access: 'write', kind: 'oauth', clientName: 'ChatGPT', maxActive: 3, now: 1_000 }

describe('Convex MCP grants', () => {
  test('every function rejects a wrong server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(query('getByServer'), { serverSecret: 'nope', grantId: 'x' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('createByServer'), { ...base, serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
  })

  test('a grant is created, listed per person, and revoked only by its owner', async () => {
    const convex = convexTest(schema, modules)
    const created = await convex.mutation(mutation('createByServer'), base)
    expect(created.ok).toBe(true)
    const listed = await convex.query(query('listByUserByServer'), { serverSecret: secret, userId: 'user_1' })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ clientName: 'ChatGPT', access: 'write', workspaceId: 'ws_1' })
    expect(await convex.query(query('listByUserByServer'), { serverSecret: secret, userId: 'user_2' })).toEqual([])
    expect(await convex.mutation(mutation('revokeByServer'), { serverSecret: secret, grantId: created.id, userId: 'user_2', now: 2_000 })).toBe(false)
    expect(await convex.mutation(mutation('revokeByServer'), { serverSecret: secret, grantId: created.id, userId: 'user_1', now: 2_000 })).toBe(true)
    expect(await convex.query(query('listByUserByServer'), { serverSecret: secret, userId: 'user_1' })).toEqual([])
    expect((await convex.query(query('getByServer'), { serverSecret: secret, grantId: created.id }))?.revokedAt).toBe(2_000)
  })

  test('an authorization code redeems once; a second redemption ends the grant it made', async () => {
    const convex = convexTest(schema, modules)
    const first = await convex.mutation(mutation('createByServer'), { ...base, codeId: 'code-1' })
    expect(first.ok).toBe(true)
    const second = await convex.mutation(mutation('createByServer'), { ...base, codeId: 'code-1', now: 2_000 })
    expect(second).toEqual({ ok: false, reason: 'code_already_used' })
    expect((await convex.query(query('getByServer'), { serverSecret: secret, grantId: first.id }))?.revokedAt).toBe(2_000)
  })

  test('refresh rotates the version, and an old refresh token revokes the grant', async () => {
    const convex = convexTest(schema, modules)
    const { id } = await convex.mutation(mutation('createByServer'), base)
    expect(await convex.mutation(mutation('rotateRefreshByServer'), { serverSecret: secret, grantId: id, presentedVersion: 0, now: 2_000 })).toEqual({ ok: true, version: 1 })
    expect(await convex.mutation(mutation('rotateRefreshByServer'), { serverSecret: secret, grantId: id, presentedVersion: 1, now: 3_000 })).toEqual({ ok: true, version: 2 })
    expect(await convex.mutation(mutation('rotateRefreshByServer'), { serverSecret: secret, grantId: id, presentedVersion: 1, now: 4_000 })).toEqual({ ok: false, reason: 'reused' })
    expect(await convex.mutation(mutation('rotateRefreshByServer'), { serverSecret: secret, grantId: id, presentedVersion: 2, now: 5_000 })).toEqual({ ok: false, reason: 'revoked' })
  })

  test('personal tokens do not refresh, and a person holds a bounded number of grants', async () => {
    const convex = convexTest(schema, modules)
    const token = await convex.mutation(mutation('createByServer'), { ...base, kind: 'token' })
    expect((await convex.mutation(mutation('rotateRefreshByServer'), { serverSecret: secret, grantId: token.id, presentedVersion: 0, now: 2_000 })).reason).toBe('not_refreshable')
    await convex.mutation(mutation('createByServer'), base)
    await convex.mutation(mutation('createByServer'), base)
    expect(await convex.mutation(mutation('createByServer'), base)).toEqual({ ok: false, reason: 'too_many_grants' })
  })

  test('deleting an account removes its grants', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('createByServer'), base)
    await convex.mutation(mutation('createByServer'), { ...base, userId: 'user_2' })
    expect(await convex.mutation(mutation('deleteAllByUserByServer'), { serverSecret: secret, userId: 'user_1' })).toBe(1)
    expect(await convex.query(query('listByUserByServer'), { serverSecret: secret, userId: 'user_2' })).toHaveLength(1)
  })
})
