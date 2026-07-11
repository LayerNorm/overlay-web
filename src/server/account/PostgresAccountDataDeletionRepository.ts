import 'server-only'

import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  AccountDataDeletionCounts,
  AccountDataDeletionRepository,
  AccountDataDeletionResult,
} from './AccountDataDeletionRepository'
import { enqueueStorageCleanupJobs } from '@/server/storage/PostgresStorageCleanupJobs'
import {
  isOwnedFileR2Key,
  isOwnedOutputR2Key,
} from '@/server/storage/storage-keys'

const ZERO_COUNTS: AccountDataDeletionCounts = {
  apiIdempotencyKeys: 0,
  authIdentities: 0,
  conversationContextSummaries: 0,
  conversationEvents: 0,
  conversationMessageDeltas: 0,
  conversationMessages: 0,
  conversations: 0,
  daytonaWorkspaces: 0,
  files: 0,
  notes: 0,
  onboardingState: 0,
  projects: 0,
  r2UploadIntents: 0,
  userSettings: 0,
  users: 0,
}

export class PostgresAccountDataDeletionRepository implements AccountDataDeletionRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async deleteUserAccount(args: { userId: string }): Promise<AccountDataDeletionResult> {
    return await this.db.transaction(async (tx) => {
      const email = await selectUserEmail(tx, args.userId)
      const r2Keys = await selectR2Keys(tx, args.userId)
      const storageIds = await selectStorageIds(tx, args.userId)
      const beforeCounts = await countUserRows(tx, args.userId)

      await enqueueStorageCleanupJobs(tx, {
        dedupeKey: `account-delete:${args.userId}`,
        keys: r2Keys,
        reason: 'account-delete',
        userId: args.userId,
      })

      await tx.execute(sql`
        DELETE FROM users
        WHERE id = ${args.userId}
      `)

      const remainingRowsByTable = await countUserRows(tx, args.userId)
      const orphanedRowCount = sumCounts(remainingRowsByTable)

      return {
        deletedRowCount: sumCounts(beforeCounts),
        email,
        r2Keys,
        storageIds,
        userExisted: beforeCounts.users > 0,
        verification: {
          orphanedRowCount,
          remainingRowsByTable,
        },
      }
    })
  }
}

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]

async function selectUserEmail(tx: Transaction, userId: string): Promise<string | undefined> {
  const result = await tx.execute<{ email: string }>(sql`
    SELECT email
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `)
  return result.rows[0]?.email
}

async function selectR2Keys(tx: Transaction, userId: string): Promise<string[]> {
  const result = await tx.execute<{ r2_key: string }>(sql`
    SELECT r2_key
    FROM files
    WHERE user_id = ${userId}
      AND r2_key IS NOT NULL
    UNION
    SELECT r2_key
    FROM r2_upload_intents
    WHERE user_id = ${userId}
      AND r2_key IS NOT NULL
  `)
  return result.rows
    .map((row) => row.r2_key)
    .filter((key) => isOwnedFileR2Key(userId, key) || isOwnedOutputR2Key(userId, key))
}

async function selectStorageIds(tx: Transaction, userId: string): Promise<string[]> {
  const result = await tx.execute<{ storage_id: string }>(sql`
    SELECT storage_id
    FROM files
    WHERE user_id = ${userId}
      AND storage_id IS NOT NULL
  `)
  return result.rows.map((row) => row.storage_id).filter(Boolean)
}

async function countUserRows(tx: Transaction, userId: string): Promise<AccountDataDeletionCounts> {
  const result = await tx.execute<{
    api_idempotency_keys: number
    auth_identities: number
    conversation_context_summaries: number
    conversation_events: number
    conversation_message_deltas: number
    conversation_messages: number
    conversations: number
    daytona_workspaces: number
    files: number
    notes: number
    onboarding_state: number
    projects: number
    r2_upload_intents: number
    user_settings: number
    users: number
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM api_idempotency_keys WHERE user_id = ${userId}) AS api_idempotency_keys,
      (SELECT count(*)::int FROM auth_identities WHERE user_id = ${userId}) AS auth_identities,
      (SELECT count(*)::int FROM conversation_context_summaries WHERE user_id = ${userId}) AS conversation_context_summaries,
      (SELECT count(*)::int FROM conversation_events WHERE user_id = ${userId}) AS conversation_events,
      (SELECT count(*)::int FROM conversation_message_deltas WHERE user_id = ${userId}) AS conversation_message_deltas,
      (SELECT count(*)::int FROM conversation_messages WHERE user_id = ${userId}) AS conversation_messages,
      (SELECT count(*)::int FROM conversations WHERE user_id = ${userId}) AS conversations,
      (SELECT count(*)::int FROM daytona_workspaces WHERE user_id = ${userId}) AS daytona_workspaces,
      (SELECT count(*)::int FROM files WHERE user_id = ${userId}) AS files,
      (SELECT count(*)::int FROM notes WHERE user_id = ${userId}) AS notes,
      (SELECT count(*)::int FROM onboarding_state WHERE user_id = ${userId}) AS onboarding_state,
      (SELECT count(*)::int FROM projects WHERE user_id = ${userId}) AS projects,
      (SELECT count(*)::int FROM r2_upload_intents WHERE user_id = ${userId}) AS r2_upload_intents,
      (SELECT count(*)::int FROM user_settings WHERE user_id = ${userId}) AS user_settings,
      (SELECT count(*)::int FROM users WHERE id = ${userId}) AS users
  `)
  const row = result.rows[0]
  if (!row) return { ...ZERO_COUNTS }

  return {
    apiIdempotencyKeys: Number(row.api_idempotency_keys ?? 0),
    authIdentities: Number(row.auth_identities ?? 0),
    conversationContextSummaries: Number(row.conversation_context_summaries ?? 0),
    conversationEvents: Number(row.conversation_events ?? 0),
    conversationMessageDeltas: Number(row.conversation_message_deltas ?? 0),
    conversationMessages: Number(row.conversation_messages ?? 0),
    conversations: Number(row.conversations ?? 0),
    daytonaWorkspaces: Number(row.daytona_workspaces ?? 0),
    files: Number(row.files ?? 0),
    notes: Number(row.notes ?? 0),
    onboardingState: Number(row.onboarding_state ?? 0),
    projects: Number(row.projects ?? 0),
    r2UploadIntents: Number(row.r2_upload_intents ?? 0),
    userSettings: Number(row.user_settings ?? 0),
    users: Number(row.users ?? 0),
  }
}

function sumCounts(counts: AccountDataDeletionCounts): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}
