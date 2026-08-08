import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { AutomationRunSummary } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  automationRuns,
  automations,
  automationTriggers,
  conversations,
  durableJobs,
} from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  computeNextAutomationRunAt,
  DEFAULT_AUTOMATION_SCHEDULE,
  normalizeAutomationSchedule,
} from './AutomationSchedule'
import type {
  AutomationExecutionPayload,
  AutomationRecord,
  AutomationRepository,
  AutomationRunTarget,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './AutomationRepository'
import { AUTOMATION_EXECUTE_JOB } from './PostgresAutomationRunCoordinator'

type AutomationRow = typeof automations.$inferSelect
type AutomationRunRow = typeof automationRuns.$inferSelect

export class PostgresAutomationRepository implements AutomationRepository {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly conversationRepository: Pick<
      ActConversationRepository,
      'addMessage' | 'deleteConversation'
    >,
  ) {}

  async listAutomations(args: {
    includeDeleted?: boolean
    projectId?: string
    userId: string
    workspaceId?: string
  }): Promise<AutomationRecord[]> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(and(
        eq(automations.userId, args.userId),
        args.includeDeleted ? undefined : isNull(automations.deletedAt),
        args.projectId ? eq(automations.projectId, args.projectId) : undefined,
        args.workspaceId ? eq(automations.workspaceId, args.workspaceId) : undefined,
      ))
      .orderBy(desc(automations.updatedAt))
      .limit(200)
    return rows.map(mapAutomation)
  }

  async listRuns(args: { automationId: string; userId: string }): Promise<AutomationRunSummary[]> {
    const rows = await this.db
      .select({ run: automationRuns })
      .from(automationRuns)
      .innerJoin(automations, and(
        eq(automations.id, automationRuns.automationId),
        eq(automations.userId, args.userId),
        isNull(automations.deletedAt),
      ))
      .where(eq(automationRuns.automationId, args.automationId))
      .orderBy(desc(automationRuns.createdAt))
      .limit(50)
    return rows.map(({ run }) => mapRun(run))
  }

  async getAutomation(args: { automationId: string; userId: string; workspaceId?: string }): Promise<AutomationRecord | null> {
    const [row] = await this.db
      .select()
      .from(automations)
      .where(and(
        eq(automations.id, args.automationId),
        eq(automations.userId, args.userId),
        isNull(automations.deletedAt),
        args.workspaceId ? eq(automations.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? mapAutomation(row) : null
  }

  async getAutomationRunTarget(args: {
    automationId: string
    userId: string
  }): Promise<AutomationRunTarget | null> {
    return await this.getAutomation(args)
  }

  async createAutomation(args: CreateAutomationInput): Promise<string> {
    return await this.db.transaction(async (tx) => {
      await assertActivePostgresProject(tx, { projectId: args.projectId, userId: args.userId })
      await assertConversationAccess(tx, {
        conversationId: args.sourceConversationId,
        userId: args.userId,
      })
      const now = Date.now()
      const schedule = normalizeAutomationSchedule(args.schedule)
      const enabled = args.enabled !== false
      const nextRunAt = enabled ? computeNextAutomationRunAt(schedule, now) : undefined
      const id = `automation_${randomUUID()}`
      await tx.insert(automations).values({
        concurrencyPolicy: args.concurrencyPolicy ?? 'skip',
        createdAt: new Date(now),
        description: args.description?.trim() ?? '',
        enabled,
        graphSource: normalizeOptional(args.graphSource),
        graph: args.graph ?? null,
        id,
        instructions: args.instructions.trim(),
        modelId: normalizeOptional(args.modelId),
        name: args.name.trim() || 'Untitled automation',
        nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
        projectId: normalizeOptional(args.projectId),
        schedule,
        sourceConversationId: normalizeOptional(args.sourceConversationId),
        timezone: args.timezone?.trim() || 'UTC',
        updatedAt: new Date(now),
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
      await tx.insert(automationTriggers).values({
        automationId: id,
        config: schedule,
        createdAt: new Date(now),
        enabled,
        id: `automation_trigger_${randomUUID()}`,
        kind: 'schedule',
        nextFireAt: nextRunAt ? new Date(nextRunAt) : null,
        updatedAt: new Date(now),
      })
      return id
    })
  }

  async updateAutomation(args: UpdateAutomationInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(automations)
        .where(and(
          eq(automations.id, args.automationId),
          eq(automations.userId, args.userId),
          isNull(automations.deletedAt),
          args.workspaceId ? eq(automations.workspaceId, args.workspaceId) : undefined,
        ))
        .limit(1)
      if (!current) throw new Error('Unauthorized')
      await assertActivePostgresProject(tx, { projectId: args.projectId, userId: args.userId })
      await assertConversationAccess(tx, {
        conversationId: args.sourceConversationId,
        userId: args.userId,
      })

      const now = Date.now()
      const schedule = args.schedule
        ? normalizeAutomationSchedule(args.schedule)
        : current.schedule
      const enabled = args.enabled ?? current.enabled
      const shouldRecompute = args.schedule !== undefined || args.enabled === true
      const nextRunAt = !enabled
        ? null
        : shouldRecompute
          ? new Date(computeNextAutomationRunAt(schedule, now))
          : current.nextRunAt
      await tx
        .update(automations)
        .set({
          ...(args.concurrencyPolicy !== undefined ? { concurrencyPolicy: args.concurrencyPolicy } : {}),
          ...(args.description !== undefined ? { description: args.description.trim() } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(args.graphSource !== undefined ? { graphSource: normalizeOptional(args.graphSource) } : {}),
          ...(args.graph !== undefined ? { graph: args.graph ?? null } : {}),
          ...(args.instructions !== undefined ? { instructions: args.instructions.trim() } : {}),
          ...(args.modelId !== undefined ? { modelId: normalizeOptional(args.modelId) } : {}),
          ...(args.name !== undefined ? { name: args.name.trim() || current.name } : {}),
          ...(args.projectId !== undefined ? { projectId: normalizeOptional(args.projectId) } : {}),
          ...(args.schedule !== undefined ? { schedule } : {}),
          ...(args.sourceConversationId !== undefined
            ? { sourceConversationId: normalizeOptional(args.sourceConversationId) }
            : {}),
          ...(args.timezone !== undefined ? { timezone: args.timezone.trim() || 'UTC' } : {}),
          nextRunAt,
          updatedAt: new Date(now),
        })
        .where(and(
          eq(automations.id, args.automationId),
          args.workspaceId ? eq(automations.workspaceId, args.workspaceId) : undefined,
        ))
      await tx
        .update(automationTriggers)
        .set({
          config: schedule,
          enabled,
          nextFireAt: nextRunAt,
          updatedAt: new Date(now),
        })
        .where(and(
          eq(automationTriggers.automationId, args.automationId),
          eq(automationTriggers.kind, 'schedule'),
        ))
    })
  }

  async attachSourceConversation(args: {
    automationId: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await assertConversationAccess(tx, {
        conversationId: args.conversationId,
        userId: args.userId,
      })
      await tx
        .update(automations)
        .set({
          sourceConversationId: args.conversationId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(automations.id, args.automationId),
          eq(automations.userId, args.userId),
          isNull(automations.sourceConversationId),
          isNull(automations.deletedAt),
        ))
    })
  }

  async pauseAutomation(args: { automationId: string; userId: string }): Promise<void> {
    await this.setEnabled({ ...args, enabled: false })
  }

  async resumeAutomation(args: { automationId: string; userId: string }): Promise<void> {
    await this.setEnabled({ ...args, enabled: true })
  }

  async removeAutomation(args: { automationId: string; userId: string; workspaceId?: string }): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(automations)
        .set({ deletedAt: now, enabled: false, nextRunAt: null, updatedAt: now })
        .where(and(
          eq(automations.id, args.automationId),
          eq(automations.userId, args.userId),
          isNull(automations.deletedAt),
          args.workspaceId ? eq(automations.workspaceId, args.workspaceId) : undefined,
        ))
        .returning({ id: automations.id })
      if (rows.length === 0) throw new Error('Unauthorized')
      await tx
        .update(automationTriggers)
        .set({ enabled: false, nextFireAt: null, updatedAt: now })
        .where(eq(automationTriggers.automationId, args.automationId))
    })
  }

  async requestRunCancellation(args: { runId: string; userId: string }): Promise<boolean> {
    const now = new Date()
    const rows = await this.db
      .update(automationRuns)
      .set({ cancellationRequestedAt: now, status: 'cancel_requested', updatedAt: now })
      .where(and(
        eq(automationRuns.id, args.runId),
        eq(automationRuns.userId, args.userId),
        inArray(automationRuns.status, ['queued', 'running']),
      ))
      .returning({ id: automationRuns.id })
    return rows.length > 0
  }

  async retryRun(args: { runId: string; userId: string }): Promise<string | null> {
    return await this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ automationId: automationRuns.automationId })
        .from(automationRuns)
        .innerJoin(automations, and(
          eq(automations.id, automationRuns.automationId),
          eq(automations.userId, args.userId),
          isNull(automations.deletedAt),
        ))
        .where(and(
          eq(automationRuns.id, args.runId),
          eq(automationRuns.userId, args.userId),
          inArray(automationRuns.status, ['failed', 'dead_letter', 'cancelled']),
        ))
        .limit(1)
      if (!previous) return null
      const runId = `automation_run_${randomUUID()}`
      const jobId = randomUUID()
      const now = new Date()
      await tx.insert(automationRuns).values({
        automationId: previous.automationId,
        id: runId,
        idempotencyKey: `retry:${args.runId}:${runId}`,
        jobId,
        scheduledFor: now,
        status: 'queued',
        triggerSource: 'manual',
        userId: args.userId,
      })
      await tx.insert(durableJobs).values({
        dedupeKey: `automation-run:${runId}`,
        id: jobId,
        maxAttempts: 5,
        payload: { runId },
        priority: 10,
        type: AUTOMATION_EXECUTE_JOB,
      })
      return runId
    })
  }

  async removeConversation(args: { conversationId: string; userId: string }): Promise<void> {
    await this.conversationRepository.deleteConversation({
      conversationId: args.conversationId as Id<'conversations'>,
      userId: args.userId,
    })
  }

  async appendAutomationUpdateNote(args: {
    automationId: string
    content: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await this.conversationRepository.addMessage({
      content: args.content,
      contentType: 'text',
      conversationId: args.conversationId as Id<'conversations'>,
      mode: 'act',
      parts: [{ type: 'text', text: args.content }],
      role: 'assistant',
      skipMemoryExtraction: true,
      turnId: `automation-update-${args.automationId}-${Date.now()}`,
      userId: args.userId,
    })
  }

  async createManualRun(args: {
    automationId: string
    scheduledFor: number
    userId: string
  }): Promise<string | null> {
    const [automation] = await this.db
      .select({ id: automations.id })
      .from(automations)
      .where(and(
        eq(automations.id, args.automationId),
        eq(automations.userId, args.userId),
        isNull(automations.deletedAt),
      ))
      .limit(1)
    if (!automation) throw new Error('Unauthorized')
    const id = `automation_run_${randomUUID()}`
    const [run] = await this.db
      .insert(automationRuns)
      .values({
        automationId: args.automationId,
        id,
        idempotencyKey: `manual:${id}`,
        scheduledFor: new Date(args.scheduledFor),
        status: 'queued',
        triggerSource: 'manual',
        userId: args.userId,
      })
      .returning({ id: automationRuns.id })
    return run?.id ?? null
  }

  async markManualRunStarted(args: {
    conversationId?: string
    now: number
    runId: string
    turnId: string
    userId: string
  }): Promise<void> {
    await this.db
      .update(automationRuns)
      .set({
        conversationId: args.conversationId,
        startedAt: new Date(args.now),
        status: 'running',
        turnId: args.turnId,
        updatedAt: new Date(args.now),
      })
      .where(and(
        eq(automationRuns.id, args.runId),
        eq(automationRuns.userId, args.userId),
        eq(automationRuns.status, 'queued'),
      ))
  }

  async markManualRunCompleted(args: {
    conversationId?: string
    now: number
    runId: string
    userId: string
  }): Promise<void> {
    await this.completeRun({ ...args, status: 'succeeded' })
  }

  async markManualRunFailed(args: {
    error: string
    now: number
    runId: string
    userId: string
  }): Promise<void> {
    await this.completeRun({ ...args, status: 'failed' })
  }

  async getRunForExecution(args: { runId: string }): Promise<AutomationExecutionPayload | null> {
    const [row] = await this.db
      .select({ automation: automations, run: automationRuns })
      .from(automationRuns)
      .innerJoin(automations, and(
        eq(automations.id, automationRuns.automationId),
        isNull(automations.deletedAt),
      ))
      .where(eq(automationRuns.id, args.runId))
      .limit(1)
    return row
      ? {
          automation: mapAutomation(row.automation),
          run: { ...mapRun(row.run), userId: row.run.userId },
        }
      : null
  }

  async updateRunWorkflowRunId(args: {
    runId: string
    workflowRunId: string
  }): Promise<void> {
    await this.db
      .update(automationRuns)
      .set({ workflowRunId: args.workflowRunId, updatedAt: new Date() })
      .where(eq(automationRuns.id, args.runId))
  }

  async updateSchedulerWorkflowRunId(args: {
    automationId: string
    schedulerWorkflowRunId: string | null
  }): Promise<void> {
    await this.db
      .update(automations)
      .set({ schedulerWorkflowRunId: args.schedulerWorkflowRunId, updatedAt: new Date() })
      .where(eq(automations.id, args.automationId))
  }

  private async setEnabled(args: {
    automationId: string
    enabled: boolean
    userId: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(automations)
        .where(and(
          eq(automations.id, args.automationId),
          eq(automations.userId, args.userId),
          isNull(automations.deletedAt),
        ))
        .limit(1)
      if (!current) throw new Error('Unauthorized')
      const now = Date.now()
      const nextRunAt = args.enabled
        ? new Date(computeNextAutomationRunAt(current.schedule ?? DEFAULT_AUTOMATION_SCHEDULE, now))
        : null
      await tx
        .update(automations)
        .set({ enabled: args.enabled, nextRunAt, updatedAt: new Date(now) })
        .where(eq(automations.id, args.automationId))
      await tx
        .update(automationTriggers)
        .set({ enabled: args.enabled, nextFireAt: nextRunAt, updatedAt: new Date(now) })
        .where(and(
          eq(automationTriggers.automationId, args.automationId),
          eq(automationTriggers.kind, 'schedule'),
        ))
    })
  }

  private async completeRun(args: {
    conversationId?: string
    error?: string
    now: number
    runId: string
    status: 'failed' | 'succeeded'
    userId: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .update(automationRuns)
        .set({
          completedAt: new Date(args.now),
          ...(args.conversationId ? { conversationId: args.conversationId } : {}),
          error: args.error ?? null,
          status: args.status,
          updatedAt: new Date(args.now),
        })
        .where(and(
          eq(automationRuns.id, args.runId),
          eq(automationRuns.userId, args.userId),
        ))
        .returning()
      if (!run) return
      await tx
        .update(automations)
        .set({
          ...(args.conversationId ? { conversationId: args.conversationId } : {}),
          lastError: args.error ?? null,
          lastRunAt: new Date(args.now),
          lastRunStatus: args.status,
          updatedAt: new Date(args.now),
        })
        .where(eq(automations.id, run.automationId))
    })
  }
}

async function assertConversationAccess(
  db: Pick<OverlayPostgresDb, 'select'>,
  args: { conversationId?: string; userId: string },
): Promise<void> {
  if (!args.conversationId) return
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, args.conversationId),
      eq(conversations.userId, args.userId),
      isNull(conversations.deletedAt),
    ))
    .limit(1)
  if (!conversation) throw new Error('Unauthorized')
}

function mapAutomation(row: AutomationRow): AutomationRecord {
  return {
    _id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    enabled: row.enabled,
    schedule: row.schedule,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt?.getTime(),
    lastRunAt: row.lastRunAt?.getTime(),
    lastRunStatus: row.lastRunStatus ?? undefined,
    lastError: row.lastError ?? undefined,
    projectId: row.projectId ?? undefined,
    modelId: row.modelId ?? undefined,
    graphSource: row.graphSource ?? undefined,
    graph: row.graph ?? undefined,
    sourceConversationId: row.sourceConversationId ?? undefined,
    conversationId: row.conversationId ?? undefined,
    concurrencyPolicy: row.concurrencyPolicy,
    schedulerWorkflowRunId: row.schedulerWorkflowRunId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}

function mapRun(row: AutomationRunRow): AutomationRunSummary {
  return {
    _id: row.id,
    automationId: row.automationId,
    userId: row.userId,
    status: row.status,
    scheduledFor: row.scheduledFor.getTime(),
    startedAt: row.startedAt?.getTime(),
    completedAt: row.completedAt?.getTime(),
    conversationId: row.conversationId ?? undefined,
    turnId: row.turnId ?? undefined,
    error: row.error ?? undefined,
    triggerSource: row.triggerSource,
    workflowRunId: row.workflowRunId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null
}
