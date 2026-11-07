import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
const modules = import.meta.glob('./**/*.ts')

const append = makeFunctionReference<'mutation'>('admin/administration:appendAuditByServer')
const listForWorkspace = makeFunctionReference<'query'>('collaboration/workspaces:listWorkspaceAuditEventsByServer')
const backfill = makeFunctionReference<'mutation'>('migrations/backfillAuditWorkspaceIds:run')

function event(eventId: string, metadata: Record<string, unknown>, createdAt: number, outcome = 'success') {
  return {
    serverSecret: 'web-test-only', eventId, actorType: 'user', actorUserId: 'user_owner',
    action: 'workspace.grant', resourceType: 'workspace', outcome,
    metadataJson: JSON.stringify(metadata), createdAt,
  }
}

describe('workspace-scoped audit reads', () => {
  test('returns only the requested workspace, newest first, behind the server secret', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await t.mutation(append, event('a1', { workspaceId: 'ws_a' }, 1))
    await t.mutation(append, event('a2', { workspaceId: 'ws_a' }, 3, 'denied'))
    await t.mutation(append, event('b1', { workspaceId: 'ws_b' }, 2))
    await t.mutation(append, event('none', {}, 4))

    const rows = await t.query(listForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a' })
    expect(rows.map((row: { eventId: string }) => row.eventId)).toEqual(['a2', 'a1'])
    const recent = await t.query(listForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a', fromRecordedAt: 2 })
    expect(recent.map((row: { eventId: string }) => row.eventId)).toEqual(['a2'])
    await expect(t.query(listForWorkspace, { serverSecret: 'wrong', workspaceId: 'ws_a' })).rejects.toThrow()
  })

  test('backfill scopes rows written before the workspace column existed', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('auditEvents', {
        eventId: 'legacy', actorType: 'user', action: 'workspace.membership', resourceType: 'workspace',
        outcome: 'denied', metadataJson: JSON.stringify({ workspaceId: 'ws_a' }), createdAt: 1,
      })
      await ctx.db.insert('auditEvents', {
        eventId: 'unscoped', actorType: 'system', action: 'other', resourceType: 'x',
        outcome: 'success', metadataJson: 'not json', createdAt: 2,
      })
    })
    expect(await t.query(listForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a' })).toEqual([])
    expect(await t.mutation(backfill, {})).toEqual({ scanned: 2, updated: 1, isDone: true })
    const rows = await t.query(listForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a' })
    expect(rows.map((row: { eventId: string }) => row.eventId)).toEqual(['legacy'])
  })
})
