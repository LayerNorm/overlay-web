import 'server-only'

import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { PostgresConnectedAgentRepository } from '@/server/agents/PostgresConnectedAgentRepository'
import type { ConnectedAgentSweepResult } from '@/server/agents/ConnectedAgentRepository'
import {
  conversationEvents,
  agentRuns,
  conversationMessages,
} from '@/server/database/postgres/schema'

const DEFAULT_EMPTY_CONVERSATION_CUTOFF_MINUTES = 60
const DEFAULT_EVENT_CUTOFF_MINUTES = 24 * 60
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

export interface PostgresBackgroundMaintenanceSummary {
  expiredAgentRuns: {
    failed: number
  }
  remoteAgentRuns: ConnectedAgentSweepResult
  connectedAgentRateWindows: { deleted: number }
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
    emptyConversationCutoffMinutes?: number
    limit?: number
    now?: Date
  } = {}): Promise<PostgresBackgroundMaintenanceSummary> {
    const limit = normalizeLimit(options.limit)
    const expiredAgentRuns = await this.expireToolLoopAgentRunLeases({
      limit,
      now: options.now,
    })
    const remoteAgentRuns = await new PostgresConnectedAgentRepository(this.db).sweepRemoteRuns({
      now: (options.now ?? new Date()).getTime(),
      hostOfflineBefore: (options.now ?? new Date()).getTime() - 90_000,
      limit,
    })
    const connectedAgentRateWindows = await this.cleanupConnectedAgentRateWindows({ now: options.now, limit })
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
      remoteAgentRuns,
      connectedAgentRateWindows,
      oldConversationEvents,
      emptyConversations,
    }
  }

  async cleanupConnectedAgentRateWindows(options: { limit?: number; now?: Date } = {}) {
    const cutoff = new Date((options.now ?? new Date()).getTime() - 10 * 60_000)
    const result = await this.db.execute<{ environment_id: string }>(sql`
      WITH candidates AS (
        SELECT environment_id, window_started_at
        FROM agent_event_rate_windows
        WHERE window_started_at < ${cutoff}
        ORDER BY window_started_at ASC
        LIMIT ${normalizeLimit(options.limit)}
      ), deleted AS (
        DELETE FROM agent_event_rate_windows w
        USING candidates c
        WHERE w.environment_id = c.environment_id
          AND w.window_started_at = c.window_started_at
        RETURNING w.environment_id
      )
      SELECT environment_id FROM deleted
    `)
    return { deleted: result.rows.length }
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
        // Room turns run as durable workflows rather than in-request tool
        // loops, but they expire the same way: the lease is the outer bound on
        // a run whose executor disappeared, whichever executor that was.
        or(
          eq(agentRuns.runner, 'tool_loop'),
          and(eq(agentRuns.runner, 'workflow'), eq(agentRuns.mode, 'room')),
        ),
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
          metrics: {
            ...run.metrics,
            processFailureDetectedAt: now.getTime(),
            staleDetectedAt: now.getTime(),
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

function minutesAgo(now: Date, minutes: number): Date {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, minutes) : 1
  return new Date(now.getTime() - safeMinutes * 60_000)
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit!)))
}
