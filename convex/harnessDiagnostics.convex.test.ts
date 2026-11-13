import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { createHarnessDiagnostic } from '../packages/overlay-agent-runtime/src/harness-diagnostic'
import { appendHarnessDiagnosticIndex } from './harness/diagnostic-index'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const backfill = makeFunctionReference<'mutation'>('harness/diagnosticBackfill:backfill')

describe('harness diagnostic index backfill', () => {
  test('backfills bounded resumable metadata and journal pages idempotently', async () => {
    const convex = convexTest(schema, modules)
    const metadataDiagnostic = createHarnessDiagnostic({
      diagnosticId: 'hd_backfill_metadata', code: 'TOOL_OUTCOME_UNKNOWN', stage: 'tool',
      operationId: 'tool-call-metadata', occurredAt: 1,
    })
    const journalDiagnostic = createHarnessDiagnostic({
      diagnosticId: 'hd_backfill_journal', code: 'TOOL_FAILED', stage: 'tool',
      operationId: 'tool-call-journal', occurredAt: 2,
    })
    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId: 'backfill-run', actorUserId: 'actor', rootRunId: 'backfill-run', activeDescendantCount: 0,
        sourceJson: JSON.stringify({ conversationId: 'conversation-backfill' }), admissionJson: '{}',
        metadataJson: JSON.stringify({
          workflowRunId: 'workflow-current', policy: { workspaceId: 'workspace-backfill' },
          diagnostic: metadataDiagnostic,
        }),
        createdAt: 1, updatedAt: 2,
      })
      for (let index = 0; index < 101; index++) {
        const operation = index === 0
          ? { type: 'record_diagnostic', diagnostic: journalDiagnostic }
          : { type: 'checkpoint', summary: 'No diagnostic.' }
        await ctx.db.insert('harnessOperations', {
          runId: 'backfill-run', operationId: `legacy-operation-${index}`,
          operationJson: JSON.stringify(operation), appliedRevision: 0, createdAt: index + 1,
        })
      }
    })

    const metadata = await convex.mutation(backfill, { source: 'metadata', cursor: null })
    expect(metadata).toMatchObject({ source: 'metadata', processed: 1, diagnosticsFound: 1, inserted: 1, isDone: true })
    expect(await convex.mutation(backfill, { source: 'metadata', cursor: null }))
      .toMatchObject({ inserted: 0, alreadyPresent: 1 })

    const first = await convex.mutation(backfill, { source: 'journal', cursor: null })
    expect(first).toMatchObject({ source: 'journal', processed: 100, isDone: false, continueCursor: expect.any(String) })
    const second = await convex.mutation(backfill, { source: 'journal', cursor: first.continueCursor })
    expect(second).toMatchObject({ source: 'journal', processed: 1, isDone: true, continueCursor: null })
    expect(first.inserted + second.inserted).toBe(1)
    const replay = await convex.mutation(backfill, { source: 'journal', cursor: null })
    expect(replay).toMatchObject({ inserted: 0, alreadyPresent: 1 })

    const rows = await convex.run(ctx => ctx.db.query('harnessDiagnosticIndex')
      .withIndex('by_runId_diagnosticId', q => q.eq('runId', 'backfill-run')).collect())
    expect(rows.map(row => row.diagnosticId).sort()).toEqual(['hd_backfill_journal', 'hd_backfill_metadata'])
    expect(rows.find(row => row.diagnosticId === 'hd_backfill_journal')?.workflowRunId).toBeUndefined()
  })

  test('owner changes and a later metadata backfill retain the first diagnostic workflow', async () => {
    const convex = convexTest(schema, modules)
    const diagnostic = createHarnessDiagnostic({
      diagnosticId: 'hd_owner_change', code: 'TOOL_OUTCOME_UNKNOWN', stage: 'tool',
      operationId: 'tool-call-owner-change', occurredAt: 3,
    })
    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId: 'owner-change-run', actorUserId: 'actor', rootRunId: 'owner-change-run', activeDescendantCount: 0,
        sourceJson: JSON.stringify({ conversationId: 'conversation-owner-change' }), admissionJson: '{}',
        metadataJson: JSON.stringify({ workflowRunId: 'workflow-current', policy: { workspaceId: 'workspace' }, diagnostic }),
        createdAt: 1, updatedAt: 2,
      })
      const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', 'owner-change-run')).unique()
      expect(run).not.toBeNull()
      await appendHarnessDiagnosticIndex(ctx, run!, {
        workflowRunId: 'workflow-original', policy: { workspaceId: 'workspace' },
      }, diagnostic)
    })
    await convex.run(async ctx => {
      const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', 'owner-change-run')).unique()
      expect(run).not.toBeNull()
      await appendHarnessDiagnosticIndex(ctx, run!, {
        workflowRunId: 'workflow-successor', policy: { workspaceId: 'workspace' },
      }, diagnostic)
    })

    const result = await convex.mutation(backfill, { source: 'metadata', cursor: null })
    expect(result).toMatchObject({ inserted: 0, alreadyPresent: 1 })
    const rows = await convex.run(ctx => ctx.db.query('harnessDiagnosticIndex')
      .withIndex('by_runId_diagnosticId', q => q.eq('runId', 'owner-change-run')).collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ diagnosticId: 'hd_owner_change', workflowRunId: 'workflow-original' })
  })

  test('malformed but valid JSON diagnostic records are skipped and counted', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId: 'malformed-diagnostic-run', actorUserId: 'actor', rootRunId: 'malformed-diagnostic-run', activeDescendantCount: 0,
        sourceJson: JSON.stringify({ conversationId: 'conversation-malformed' }), admissionJson: '{}',
        metadataJson: JSON.stringify({ diagnostic: { diagnosticId: 'hd_bad', code: 'NOT_A_CODE', stage: 'tool', occurredAt: 'yesterday' } }),
        createdAt: 1, updatedAt: 2,
      })
      await ctx.db.insert('harnessOperations', {
        runId: 'malformed-diagnostic-run', operationId: 'malformed-operation',
        operationJson: JSON.stringify({ type: 'record_diagnostic', diagnostic: { diagnosticId: 'hd_bad_journal', code: 'NOT_A_CODE' } }),
        appliedRevision: 0, createdAt: 3,
      })
    })

    expect(await convex.mutation(backfill, { source: 'metadata', cursor: null }))
      .toMatchObject({ processed: 1, diagnosticsFound: 0, malformed: 1, isDone: true })
    expect(await convex.mutation(backfill, { source: 'journal', cursor: null }))
      .toMatchObject({ processed: 1, diagnosticsFound: 0, malformed: 1, isDone: true })
    expect(await convex.run(ctx => ctx.db.query('harnessDiagnosticIndex').collect())).toHaveLength(0)
  })

  test('journal pagination limits bytes and returns a continuation cursor', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async ctx => {
      for (let index = 0; index < 100; index++) {
        await ctx.db.insert('harnessOperations', {
          runId: 'large-journal-run', operationId: `large-operation-${index}`,
          operationJson: JSON.stringify({ type: 'legacy_unknown', padding: 'x'.repeat(50_000) }),
          appliedRevision: index, createdAt: index + 1,
        })
      }
    })

    const page = await convex.mutation(backfill, { source: 'journal', cursor: null })
    expect(page.processed).toBeGreaterThan(0)
    expect(page.processed).toBeLessThan(100)
    expect(page).toMatchObject({ isDone: false, continueCursor: expect.any(String) })
  })
})
