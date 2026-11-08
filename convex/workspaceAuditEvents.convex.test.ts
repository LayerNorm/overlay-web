import { afterEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
const modules = import.meta.glob('./**/*.ts')

const append = makeFunctionReference<'mutation'>('admin/administration:appendAuditByServer')
const listForWorkspace = makeFunctionReference<'query'>('collaboration/workspaces:listWorkspaceAuditEventsByServer')
const pageForWorkspace = makeFunctionReference<'query'>('collaboration/workspaces:pageWorkspaceAuditEventsByServer')
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

  test('export pages read a whole workspace window oldest first and never cross workspaces', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    for (let index = 0; index < 5; index += 1) {
      await t.mutation(append, event(`a${index}`, { workspaceId: 'ws_a' }, 10 + index, index === 2 ? 'denied' : 'success'))
      await t.mutation(append, event(`b${index}`, { workspaceId: 'ws_b' }, 10 + index, 'denied'))
    }
    const seen: string[] = []
    let cursor: string | null = null
    let isDone = false
    while (!isDone) {
      const page: { page: Array<{ eventId: string }>; isDone: boolean; continueCursor: string } =
        await t.query(pageForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a', cursor, numItems: 2 })
      seen.push(...page.page.map((row) => row.eventId))
      isDone = page.isDone
      cursor = page.continueCursor
    }
    expect(seen).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    const fromLater = await t.query(pageForWorkspace, {
      serverSecret: 'web-test-only', workspaceId: 'ws_a', fromRecordedAt: 13, cursor: null, numItems: 10,
    })
    expect(fromLater.page.map((row: { eventId: string }) => row.eventId)).toEqual(['a3', 'a4'])
    // Workspace B's denials never appear in, or count toward, workspace A.
    const deniedInA = (await t.query(listForWorkspace, { serverSecret: 'web-test-only', workspaceId: 'ws_a' }))
      .filter((row: { outcome: string }) => row.outcome === 'denied')
    expect(deniedInA.map((row: { eventId: string }) => row.eventId)).toEqual(['a2'])
    await expect(t.query(pageForWorkspace, {
      serverSecret: 'wrong', workspaceId: 'ws_a', cursor: null, numItems: 10,
    })).rejects.toThrow()
  })

  test('backfill continues past one batch and a rerun changes nothing', async () => {
    vi.useFakeTimers()
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let index = 0; index < 450; index += 1) {
        await ctx.db.insert('auditEvents', {
          eventId: `legacy_${index}`, actorType: 'user', action: 'workspace.membership', resourceType: 'workspace',
          outcome: 'success', metadataJson: JSON.stringify({ workspaceId: index % 2 === 0 ? 'ws_a' : 'ws_b' }),
          createdAt: index,
        })
      }
    })
    expect(await t.mutation(backfill, {})).toEqual({ scanned: 200, updated: 200, isDone: false })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const counts = await t.run(async (ctx) => {
      const rows = await ctx.db.query('auditEvents').collect()
      return {
        missing: rows.filter((row) => !row.workspaceId).length,
        a: rows.filter((row) => row.workspaceId === 'ws_a').length,
        b: rows.filter((row) => row.workspaceId === 'ws_b').length,
      }
    })
    expect(counts).toEqual({ missing: 0, a: 225, b: 225 })
    expect(await t.mutation(backfill, {})).toEqual({ scanned: 200, updated: 0, isDone: false })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const missingAfterRerun = await t.run(async (ctx) =>
      (await ctx.db.query('auditEvents').collect()).filter((row) => !row.workspaceId).length)
    expect(missingAfterRerun).toBe(0)
  })
})

afterEach(() => {
  vi.useRealTimers()
})
