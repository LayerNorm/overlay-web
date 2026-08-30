import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  conversationMessages,
  conversations,
  memoryExtractionRuns,
} from '@/server/database/postgres/schema'

export type MemoryExtractionTurn = {
  contextMessages: Array<{ role: string; text: string }>
  messageId: string
  projectId?: string
  targetText: string
  targetActor: 'human' | 'agent'
  turnId: string
  workspaceId?: string
}

export class PostgresMemoryExtractionRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getTurn(args: {
    conversationId: string
    messageId: string
    targetActor?: 'human' | 'agent'
    turnId: string
    workspaceId?: string
  }): Promise<MemoryExtractionTurn | null> {
    const [conversation] = await this.db.select({
      projectId: conversations.projectId,
      workspaceId: conversations.workspaceId,
    })
      .from(conversations)
      .where(and(
        eq(conversations.id, args.conversationId),
        args.workspaceId ? eq(conversations.workspaceId, args.workspaceId) : undefined,
        isNull(conversations.deletedAt),
      ))
      .limit(1)
    if (!conversation) return null
    const rows = await this.db.select().from(conversationMessages)
      .where(eq(conversationMessages.conversationId, args.conversationId))
      .orderBy(asc(conversationMessages.createdAt))
    const recent = rows.slice(-8)
    const targetActor = args.targetActor ?? 'human'
    const target = rows.find((message) => (
      message.id === args.messageId
      && message.turnId === args.turnId
      && (targetActor === 'agent'
        ? message.role === 'assistant' && message.authorKind === 'agent'
        : message.role === 'user' && message.authorKind === 'human')
    ))
    if (!target) return null
    return {
      contextMessages: recent
        .filter((message) => message.id !== target.id)
        .map((message) => ({ role: message.role, text: messageText(message).slice(0, 800) })),
      messageId: target.id,
      projectId: conversation.projectId ?? undefined,
      targetText: messageText(target),
      targetActor,
      turnId: target.turnId,
      workspaceId: conversation.workspaceId ?? undefined,
    }
  }

  async countRunsSince(args: { since: Date; userId: string }): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(memoryExtractionRuns)
      .where(and(
        eq(memoryExtractionRuns.userId, args.userId),
        gte(memoryExtractionRuns.createdAt, args.since),
      ))
    return Number(row?.count ?? 0)
  }

  async startRun(args: {
    conversationId: string
    messageId: string
    modelId: string
    turnId: string
    userId: string
  }): Promise<string> {
    const id = `memory_run_${randomUUID()}`
    const now = new Date()
    const [row] = await this.db.insert(memoryExtractionRuns).values({
      ...args,
      id,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        memoryExtractionRuns.userId,
        memoryExtractionRuns.conversationId,
        memoryExtractionRuns.turnId,
      ],
      set: {
        attempts: sql`${memoryExtractionRuns.attempts} + 1`,
        lastError: null,
        modelId: args.modelId,
        status: 'running',
        updatedAt: now,
      },
    }).returning({ id: memoryExtractionRuns.id })
    if (!row) throw new Error('Failed to start memory extraction audit run')
    return row.id
  }

  async completeRun(args: {
    duplicateCount: number
    extractedCount: number
    insertedCount: number
    reason?: string
    runId: string
    status: 'succeeded' | 'failed' | 'skipped'
    error?: string
  }): Promise<void> {
    const now = new Date()
    await this.db.update(memoryExtractionRuns).set({
      completedAt: now,
      duplicateCount: args.duplicateCount,
      extractedCount: args.extractedCount,
      insertedCount: args.insertedCount,
      lastError: args.error?.slice(0, 2_000),
      reason: args.reason,
      status: args.status,
      updatedAt: now,
    }).where(eq(memoryExtractionRuns.id, args.runId))
  }
}

type MessageRow = typeof conversationMessages.$inferSelect

function messageText(message: MessageRow): string {
  const parts = Array.isArray(message.parts) ? message.parts : []
  const text = parts.flatMap((part) => {
    if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text') return []
    return 'text' in part && typeof part.text === 'string' ? [part.text] : []
  }).join(' ').trim()
  return text || message.content
}
