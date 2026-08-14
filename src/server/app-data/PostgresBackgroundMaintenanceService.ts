import 'server-only'

import { and, asc, eq, inArray, lt, notExists, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { CONVERSATION_EVENT_NOTIFY_CHANNEL } from '@/server/conversations/PostgresConversationEventNotifier'
import {
  conversationEvents,
  agentRuns,
  conversationMessageDeltas,
  conversationMessages,
  conversations,
} from '@/server/database/postgres/schema'

const DEFAULT_STALE_GENERATING_CUTOFF_MINUTES = 5
const DEFAULT_DELTA_CUTOFF_MINUTES = 60
const DEFAULT_EMPTY_CONVERSATION_CUTOFF_MINUTES = 60
const DEFAULT_EVENT_CUTOFF_MINUTES = 24 * 60
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const STALE_GENERATION_ERROR_TEXT = 'Generation was interrupted before the assistant finished responding.'

export interface PostgresBackgroundMaintenanceSummary {
  expiredAgentRuns: {
    failed: number
  }
  staleGeneratingMessages: {
    finalized: number
    deletedDeltas: number
  }
  inactiveMessageDeltas: {
    deleted: number
  }
  oldMessageDeltas: {
    deleted: number
  }
  oldConversationEvents: {
    deleted: number
  }
  emptyConversations: {
    deleted: number
  }
}

export class PostgresBackgroundMaintenanceService {
  constructor(private readonly db: OverlayPostgresDb) {}

  async runAll(options: {
    deltaCutoffMinutes?: number
    emptyConversationCutoffMinutes?: number
    limit?: number
    now?: Date
    staleGeneratingCutoffMinutes?: number
  } = {}): Promise<PostgresBackgroundMaintenanceSummary> {
    const limit = normalizeLimit(options.limit)
    const expiredAgentRuns = await this.expireToolLoopAgentRunLeases({
      limit,
      now: options.now,
    })
    const staleGeneratingMessages = await this.finalizeStaleGeneratingMessages({
      cutoffMinutes: options.staleGeneratingCutoffMinutes,
      limit,
      now: options.now,
    })
    const inactiveMessageDeltas = await this.cleanupInactiveMessageDeltas({ limit })
    const oldMessageDeltas = await this.cleanupOldMessageDeltas({
      cutoffMinutes: options.deltaCutoffMinutes,
      limit,
      now: options.now,
    })
    const oldConversationEvents = await this.cleanupOldConversationEvents({
      limit,
      now: options.now,
    })
    const emptyConversations = await this.cleanupEmptyConversations({
      cutoffMinutes: options.emptyConversationCutoffMinutes,
      limit,
      now: options.now,
    })

    return {
      expiredAgentRuns,
      staleGeneratingMessages,
      inactiveMessageDeltas,
      oldMessageDeltas,
      oldConversationEvents,
      emptyConversations,
    }
  }

  async finalizeStaleGeneratingMessages(options: {
    cutoffMinutes?: number
    limit?: number
    now?: Date
  } = {}): Promise<{ finalized: number; deletedDeltas: number }> {
    const now = options.now ?? new Date()
    const cutoff = minutesAgo(now, options.cutoffMinutes ?? DEFAULT_STALE_GENERATING_CUTOFF_MINUTES)
    const limit = normalizeLimit(options.limit)
    const staleMessages = await this.db
      .select()
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.status, 'generating'),
        lt(conversationMessages.updatedAt, cutoff),
        notExists(
          this.db
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(and(
              eq(agentRuns.assistantMessageId, conversationMessages.id),
              inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
            )),
        ),
      ))
      .orderBy(asc(conversationMessages.updatedAt))
      .limit(limit)

    let finalized = 0
    let deletedDeltas = 0
    for (const message of staleMessages) {
      const result = await this.db.transaction(async (tx) => {
        const deltas = await tx
          .select()
          .from(conversationMessageDeltas)
          .where(eq(conversationMessageDeltas.messageId, message.id))
          .orderBy(asc(conversationMessageDeltas.createdAt))

        const hydrated = hydrateInterruptedMessage({
          content: message.content,
          deltas,
          parts: normalizeParts(message.parts),
        })

        const [updated] = await tx
          .update(conversationMessages)
          .set({
            content: hydrated.content,
            parts: hydrated.parts,
            status: 'error',
            updatedAt: now,
          })
          .where(and(
            eq(conversationMessages.id, message.id),
            eq(conversationMessages.status, 'generating'),
          ))
          .returning({
            conversationId: conversationMessages.conversationId,
            userId: conversationMessages.userId,
            mode: conversationMessages.mode,
          })
        if (!updated) {
          return { finalized: false, deletedDeltas: 0 }
        }

        const deleted = deltas.length > 0
          ? await tx
              .delete(conversationMessageDeltas)
              .where(inArray(conversationMessageDeltas.id, deltas.map((delta) => delta.id)))
              .returning({ id: conversationMessageDeltas.id })
          : []

        await tx
          .update(conversations)
          .set({
            lastMode: updated.mode,
            lastModified: now,
            updatedAt: now,
          })
          .where(and(
            eq(conversations.id, updated.conversationId),
            eq(conversations.userId, updated.userId),
          ))
        await tx.insert(conversationEvents).values({
          userId: updated.userId,
          conversationId: updated.conversationId,
          type: 'message.failed',
          messageId: message.id,
          payload: { reason: 'stale-generation-cleanup' },
          createdAt: now,
        })
        await tx.execute(sql`SELECT pg_notify(${CONVERSATION_EVENT_NOTIFY_CHANNEL}, ${updated.userId})`)

        return { finalized: true, deletedDeltas: deleted.length }
      })
      if (result.finalized) finalized += 1
      deletedDeltas += result.deletedDeltas
    }

    return { finalized, deletedDeltas }
  }

  async expireToolLoopAgentRunLeases(options: {
    limit?: number
    now?: Date
  } = {}): Promise<{ failed: number }> {
    const now = options.now ?? new Date()
    const limit = normalizeLimit(options.limit)
    const expired = await this.db
      .select()
      .from(agentRuns)
      .where(and(
        eq(agentRuns.runner, 'tool_loop'),
        inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
        lt(agentRuns.leaseExpiresAt, now),
      ))
      .orderBy(asc(agentRuns.leaseExpiresAt))
      .limit(limit)
    const errorText = 'Generation was interrupted because the chat process stopped before completion.'
    let failed = 0
    for (const run of expired) {
      const updated = await this.db.transaction(async (tx) => {
        const [failedRun] = await tx.update(agentRuns).set({
          status: 'failed',
          failedAt: now,
          leaseExpiresAt: null,
          terminalError: {
            code: 'tool_loop_lease_expired',
            message: errorText,
            retryable: true,
          },
          updatedAt: now,
        }).where(and(
          eq(agentRuns.id, run.id),
          inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
        )).returning({ id: agentRuns.id })
        if (!failedRun) return false
        await tx.update(conversationMessages).set({
          content: errorText,
          parts: [{ type: 'text', text: errorText }],
          status: 'error',
          updatedAt: now,
        }).where(and(
          eq(conversationMessages.id, run.assistantMessageId),
          eq(conversationMessages.status, 'generating'),
        ))
        await tx.delete(conversationMessageDeltas)
          .where(eq(conversationMessageDeltas.messageId, run.assistantMessageId))
        await tx.insert(conversationEvents).values({
          userId: run.userId,
          conversationId: run.conversationId,
          type: 'message.failed',
          messageId: run.assistantMessageId,
          payload: { agentRunId: run.id, reason: 'tool-loop-lease-expired' },
          createdAt: now,
        })
        return true
      })
      if (updated) failed += 1
    }
    return { failed }
  }

  async cleanupInactiveMessageDeltas(options: {
    limit?: number
  } = {}): Promise<{ deleted: number }> {
    const limit = normalizeLimit(options.limit)
    const result = await this.db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT d.id
        FROM conversation_message_deltas d
        LEFT JOIN conversation_messages m ON m.id = d.message_id
        WHERE m.id IS NULL OR m.status <> 'generating'
        ORDER BY d.created_at ASC
        LIMIT ${limit}
      ),
      deleted AS (
        DELETE FROM conversation_message_deltas d
        USING candidates
        WHERE d.id = candidates.id
        RETURNING d.id
      )
      SELECT id FROM deleted
    `)
    return { deleted: result.rows.length }
  }

  async cleanupOldMessageDeltas(options: {
    cutoffMinutes?: number
    limit?: number
    now?: Date
  } = {}): Promise<{ deleted: number }> {
    const now = options.now ?? new Date()
    const cutoff = minutesAgo(now, options.cutoffMinutes ?? DEFAULT_DELTA_CUTOFF_MINUTES)
    const limit = normalizeLimit(options.limit)
    const result = await this.db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT d.id
        FROM conversation_message_deltas d
        WHERE d.created_at < ${cutoff}
        ORDER BY d.created_at ASC
        LIMIT ${limit}
      ),
      deleted AS (
        DELETE FROM conversation_message_deltas d
        USING candidates
        WHERE d.id = candidates.id
        RETURNING d.id
      )
      SELECT id FROM deleted
    `)
    return { deleted: result.rows.length }
  }

  async cleanupOldConversationEvents(options: {
    cutoffMinutes?: number
    limit?: number
    now?: Date
  } = {}): Promise<{ deleted: number }> {
    const now = options.now ?? new Date()
    const cutoff = minutesAgo(now, options.cutoffMinutes ?? DEFAULT_EVENT_CUTOFF_MINUTES)
    const limit = normalizeLimit(options.limit)
    const result = await this.db.execute<{ sequence: number }>(sql`
      WITH candidates AS (
        SELECT sequence
        FROM conversation_events
        WHERE created_at < ${cutoff}
        ORDER BY sequence ASC
        LIMIT ${limit}
      ),
      deleted AS (
        DELETE FROM conversation_events e
        USING candidates
        WHERE e.sequence = candidates.sequence
        RETURNING e.sequence
      )
      SELECT sequence FROM deleted
    `)
    return { deleted: result.rows.length }
  }

  async cleanupEmptyConversations(options: {
    cutoffMinutes?: number
    limit?: number
    now?: Date
  } = {}): Promise<{ deleted: number }> {
    const now = options.now ?? new Date()
    const cutoff = minutesAgo(now, options.cutoffMinutes ?? DEFAULT_EMPTY_CONVERSATION_CUTOFF_MINUTES)
    const limit = normalizeLimit(options.limit)
    const result = await this.db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT c.id
        FROM conversations c
        WHERE c.deleted_at IS NULL
          AND c.created_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1
            FROM conversation_messages m
            WHERE m.conversation_id = c.id
          )
        ORDER BY c.created_at ASC
        LIMIT ${limit}
      ),
      deleted AS (
        DELETE FROM conversations c
        USING candidates
        WHERE c.id = candidates.id
        RETURNING c.id
      )
      SELECT id FROM deleted
    `)
    return { deleted: result.rows.length }
  }
}

function hydrateInterruptedMessage(args: {
  content: string
  deltas: Array<typeof conversationMessageDeltas.$inferSelect>
  parts: Array<Record<string, unknown>>
}): { content: string; parts: Array<Record<string, unknown>> } {
  let content = args.content
  const parts = [...args.parts]

  if (!content) {
    content = args.deltas
      .map((delta) => delta.textDelta ?? '')
      .join('')
  }
  if (parts.length === 0) {
    const deltaParts = args.deltas.flatMap((delta) => normalizeParts(delta.newParts))
    if (content) parts.push({ type: 'text', text: content })
    parts.push(...deltaParts)
  }

  if (!content) content = STALE_GENERATION_ERROR_TEXT
  if (parts.length === 0) parts.push({ type: 'text', text: content })
  return { content, parts }
}

function normalizeParts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((part): part is Record<string, unknown> =>
    Boolean(part) && typeof part === 'object' && !Array.isArray(part),
  )
}

function minutesAgo(now: Date, minutes: number): Date {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, minutes) : 1
  return new Date(now.getTime() - safeMinutes * 60_000)
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit!)))
}
