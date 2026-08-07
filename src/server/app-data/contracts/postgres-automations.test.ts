import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  automationTriggers,
  conversations,
  projects,
  users,
} from '@/server/database/postgres/schema'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresAutomationRepository } from '@/server/automations/PostgresAutomationRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test(
  'Postgres automation definitions and schedule triggers',
  { skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required' },
  async (t) => {
    if (!connectionString) return
    const pool = createOverlayPostgresPool({
      connectionString,
      max: 3,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    const db = createOverlayPostgresDb(pool)
    const userId = `p6_user_${randomUUID()}`
    const foreignUserId = `p6_foreign_${randomUUID()}`
    const projectId = `p6_project_${randomUUID()}`
    const conversationId = `p6_conversation_${randomUUID()}`
    const conversationsRepository = new PostgresActConversationRepository(db)
    const repository = new PostgresAutomationRepository(db, conversationsRepository)

    try {
      await db.insert(users).values([
        { email: `${userId}@example.test`, id: userId },
        { email: `${foreignUserId}@example.test`, id: foreignUserId },
      ])
      await db.insert(projects).values({ id: projectId, name: 'P6 project', userId })
      await db.insert(conversations).values({
        actModelId: 'openai/gpt-4.1',
        askModelIds: ['openai/gpt-4.1'],
        createdAt: new Date(),
        id: conversationId,
        lastMode: 'act',
        lastModified: new Date(),
        projectId,
        title: 'Automation conversation',
        updatedAt: new Date(),
        userId,
      })

      let automationId = ''
      await t.test('create normalizes and persists one schedule trigger', async () => {
        automationId = await repository.createAutomation({
          concurrencyPolicy: 'queue',
          description: 'Daily report',
          instructions: 'Write the daily report.',
          name: 'Daily report',
          projectId,
          schedule: { kind: 'daily', hourUTC: 14, minuteUTC: 30 },
          sourceConversationId: conversationId,
          timezone: 'America/Los_Angeles',
          userId,
        })
        const [automation] = await repository.listAutomations({ userId })
        assert.equal(automation?._id, automationId)
        assert.equal(automation?.projectId, projectId)
        assert.equal(automation?.concurrencyPolicy, 'queue')
        assert.ok(automation?.nextRunAt)

        const triggers = await db
          .select()
          .from(automationTriggers)
          .where(eq(automationTriggers.automationId, automationId))
        assert.equal(triggers.length, 1)
        assert.equal(triggers[0]?.kind, 'schedule')
        assert.equal(triggers[0]?.enabled, true)
        assert.deepEqual(triggers[0]?.config, { kind: 'daily', hourUTC: 14, minuteUTC: 30 })
      })

      await t.test('ownership and project checks fail closed', async () => {
        assert.equal(await repository.getAutomation({ automationId, userId: foreignUserId }), null)
        await assert.rejects(() => repository.createAutomation({
          description: 'Foreign project',
          instructions: 'No access',
          name: 'Unauthorized',
          projectId,
          schedule: { kind: 'daily' },
          userId: foreignUserId,
        }), /Unauthorized/)
      })

      await t.test('update, pause, and resume keep definition and trigger synchronized', async () => {
        await repository.updateAutomation({
          automationId,
          name: 'Weekly report',
          schedule: { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 9 },
          userId,
        })
        await repository.pauseAutomation({ automationId, userId })
        let automation = await repository.getAutomation({ automationId, userId })
        assert.equal(automation?.enabled, false)
        assert.equal(automation?.nextRunAt, undefined)

        await repository.resumeAutomation({ automationId, userId })
        automation = await repository.getAutomation({ automationId, userId })
        assert.equal(automation?.enabled, true)
        assert.equal(automation?.name, 'Weekly report')
        assert.equal(automation?.schedule?.kind, 'weekly')
        assert.ok(automation?.nextRunAt)

        const [trigger] = await db
          .select()
          .from(automationTriggers)
          .where(and(
            eq(automationTriggers.automationId, automationId),
            eq(automationTriggers.kind, 'schedule'),
          ))
        assert.equal(trigger?.enabled, true)
        assert.ok(trigger?.nextFireAt)
      })

      await t.test('manual run lifecycle persists status and workflow ID for replay', async () => {
        const runId = await repository.createManualRun({
          automationId,
          scheduledFor: Date.now(),
          userId,
        })
        assert.ok(runId)
        await repository.updateRunWorkflowRunId({
          runId: runId!,
          workflowRunId: 'wrun_p6_replay',
        })
        await repository.markManualRunStarted({
          now: Date.now(),
          runId: runId!,
          turnId: 'turn_p6_replay',
          userId,
        })
        await repository.markManualRunCompleted({
          now: Date.now(),
          runId: runId!,
          userId,
        })

        const runs = await repository.listRuns({ automationId, userId })
        const run = runs.find((candidate) => candidate._id === runId)
        assert.equal(run?.status, 'succeeded')
        assert.equal(run?.workflowRunId, 'wrun_p6_replay')
        assert.ok(run?.startedAt)
        assert.ok(run?.completedAt)
      })

      await t.test('soft delete hides the automation and disables its trigger', async () => {
        await repository.removeAutomation({ automationId, userId })
        assert.equal(await repository.getAutomation({ automationId, userId }), null)
        assert.equal((await repository.listAutomations({ includeDeleted: true, userId })).length, 1)
        const [trigger] = await db
          .select()
          .from(automationTriggers)
          .where(eq(automationTriggers.automationId, automationId))
        assert.equal(trigger?.enabled, false)
        assert.equal(trigger?.nextFireAt, null)
      })
    } finally {
      await db.delete(users).where(eq(users.id, userId))
      await db.delete(users).where(eq(users.id, foreignUserId))
      await pool.end()
    }
  },
)
