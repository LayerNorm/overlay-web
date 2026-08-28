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
  agentRuns: 0,
  apiIdempotencyKeys: 0,
  apiKeys: 0,
  administrativePrincipals: 0,
  automationRunAttempts: 0,
  automationRuns: 0,
  automationTriggers: 0,
  automations: 0,
  billingSubscriptions: 0,
  billingTopUps: 0,
  authIdentities: 0,
  conversationContextSummaries: 0,
  conversationEvents: 0,
  conversationMessages: 0,
  conversations: 0,
  daytonaWorkspaces: 0,
  files: 0,
  knowledgeChunkEmbeddings: 0,
  knowledgeChunks: 0,
  memoryExtractionRuns: 0,
  memories: 0,
  mcpServers: 0,
  mcpToolExecutions: 0,
  notes: 0,
  onboardingState: 0,
  projects: 0,
  providerConnections: 0,
  r2UploadIntents: 0,
  skills: 0,
  userSettings: 0,
  users: 0,
  usageBudgetAccounts: 0,
  usageBudgetTransactions: 0,
  usageEvents: 0,
  usageReservations: 0,
  webhookDeliveries: 0,
  webhookDeliveryAttempts: 0,
  webhookSubscriptions: 0,
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

      await deleteUserOwnedDurableJobs(tx, args.userId)
      await deleteWorkspaceAccountState(tx, args.userId)

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

/**
 * Remove a user's private workspace and anonymize their identity in any
 * organization that remains. Personal workspaces intentionally retain a
 * RESTRICT owner foreign key, so deleting the user first would leave account
 * deletion permanently blocked. Organization history keeps the principal as
 * an archived, userless actor while memberships and live presence are removed.
 */
async function deleteWorkspaceAccountState(tx: Transaction, userId: string): Promise<void> {
  const finalOwner = await tx.execute<{ name: string }>(sql`
    SELECT workspace.name
    FROM workspaces workspace
    JOIN workspace_memberships membership
      ON membership.workspace_id = workspace.id
     AND membership.role = 'owner'
     AND membership.status = 'active'
    JOIN workspace_principals principal
      ON principal.workspace_id = membership.workspace_id
     AND principal.id = membership.principal_id
     AND principal.user_id = ${userId}
    WHERE workspace.kind = 'organization'
      AND workspace.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM workspace_memberships other_membership
        JOIN workspace_principals other_principal
          ON other_principal.workspace_id = other_membership.workspace_id
         AND other_principal.id = other_membership.principal_id
        WHERE other_membership.workspace_id = workspace.id
          AND other_membership.role = 'owner'
          AND other_membership.status = 'active'
          AND other_principal.user_id IS DISTINCT FROM ${userId}
      )
    ORDER BY workspace.id
    LIMIT 1
  `)
  if (finalOwner.rows[0]) {
    throw new Error(`Transfer ownership of ${finalOwner.rows[0].name} before deleting this account.`)
  }

  // Cascades remove all user-owned resources, workspace scopes, and the
  // personal principal without touching organization history.
  await tx.execute(sql`
    DELETE FROM workspaces
    WHERE kind = 'personal' AND personal_owner_user_id = ${userId}
  `)

  const organizationPrincipals = await tx.execute<{ id: string }>(sql`
    SELECT principal.id
    FROM workspace_principals principal
    JOIN workspaces workspace ON workspace.id = principal.workspace_id
    WHERE principal.user_id = ${userId}
      AND workspace.kind = 'organization'
  `)
  if (organizationPrincipals.rows.length === 0) return

  const principalIds = sql.join(
    organizationPrincipals.rows.map(({ id }) => sql`${id}`),
    sql`, `,
  )
  const now = new Date()

  // Preserve the message record for audit/history, but make the departed
  // principal inactive and remove ephemeral collaboration state.
  await tx.execute(sql`
    UPDATE conversation_participants
    SET status = 'removed',
        removed_at = COALESCE(removed_at, ${now}),
        updated_at = ${now}
    WHERE principal_id IN (${principalIds})
      AND status = 'active'
  `)
  await tx.execute(sql`
    DELETE FROM workspace_presence
    WHERE principal_id IN (${principalIds})
  `)
  await tx.execute(sql`
    DELETE FROM workspace_notifications
    WHERE recipient_principal_id IN (${principalIds})
       OR actor_principal_id IN (${principalIds})
  `)
  await tx.execute(sql`
    DELETE FROM workspace_identity_mappings
    WHERE principal_id IN (${principalIds})
  `)
  await tx.execute(sql`
    DELETE FROM workspace_team_members
    WHERE principal_id IN (${principalIds})
  `)
  await tx.execute(sql`
    DELETE FROM workspace_memberships
    WHERE principal_id IN (${principalIds})
  `)
  await tx.execute(sql`
    UPDATE workspace_principals
    SET user_id = NULL,
        email = NULL,
        display_name = 'Deleted member',
        archived_at = COALESCE(archived_at, ${now}),
        updated_at = ${now}
    WHERE id IN (${principalIds})
  `)
}

async function deleteUserOwnedDurableJobs(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM durable_jobs
    WHERE id IN (
      SELECT run.job_id
      FROM automation_runs run
      WHERE run.user_id = ${userId}
        AND run.job_id IS NOT NULL
    )
    OR (
      type = 'webhook.deliver'
      AND payload ->> 'deliveryId' IN (
        SELECT delivery.id
        FROM webhook_deliveries delivery
        WHERE delivery.user_id = ${userId}
      )
    )
  `)
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
    agent_runs: number
    api_idempotency_keys: number
    api_keys: number
    administrative_principals: number
    automation_run_attempts: number
    automation_runs: number
    automation_triggers: number
    automations: number
    billing_subscriptions: number
    billing_top_ups: number
    auth_identities: number
    conversation_context_summaries: number
    conversation_events: number
    conversation_messages: number
    conversations: number
    daytona_workspaces: number
    files: number
    knowledge_chunk_embeddings: number
    knowledge_chunks: number
    memory_extraction_runs: number
    memories: number
    mcp_servers: number
    mcp_tool_executions: number
    notes: number
    onboarding_state: number
    projects: number
    provider_connections: number
    r2_upload_intents: number
    skills: number
    user_settings: number
    users: number
    usage_budget_accounts: number
    usage_budget_transactions: number
    usage_events: number
    usage_reservations: number
    webhook_deliveries: number
    webhook_delivery_attempts: number
    webhook_subscriptions: number
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM agent_runs WHERE user_id = ${userId}) AS agent_runs,
      (SELECT count(*)::int FROM api_idempotency_keys WHERE user_id = ${userId}) AS api_idempotency_keys,
      (SELECT count(*)::int FROM api_keys WHERE user_id = ${userId}) AS api_keys,
      (SELECT count(*)::int FROM administrative_principals WHERE user_id = ${userId}) AS administrative_principals,
      (SELECT count(*)::int FROM automations WHERE user_id = ${userId}) AS automations,
      (SELECT count(*)::int FROM billing_subscriptions WHERE user_id = ${userId}) AS billing_subscriptions,
      (SELECT count(*)::int FROM billing_top_ups WHERE user_id = ${userId}) AS billing_top_ups,
      (SELECT count(*)::int FROM automation_runs WHERE user_id = ${userId}) AS automation_runs,
      (SELECT count(*)::int FROM automation_triggers trigger JOIN automations automation ON automation.id = trigger.automation_id WHERE automation.user_id = ${userId}) AS automation_triggers,
      (SELECT count(*)::int FROM automation_run_attempts attempt JOIN automation_runs run ON run.id = attempt.run_id WHERE run.user_id = ${userId}) AS automation_run_attempts,
      (SELECT count(*)::int FROM auth_identities WHERE user_id = ${userId}) AS auth_identities,
      (SELECT count(*)::int FROM conversation_context_summaries WHERE user_id = ${userId}) AS conversation_context_summaries,
      (SELECT count(*)::int FROM conversation_events WHERE user_id = ${userId}) AS conversation_events,
      (SELECT count(*)::int FROM conversation_messages WHERE user_id = ${userId}) AS conversation_messages,
      (SELECT count(*)::int FROM conversations WHERE user_id = ${userId}) AS conversations,
      (SELECT count(*)::int FROM daytona_workspaces WHERE user_id = ${userId}) AS daytona_workspaces,
      (SELECT count(*)::int FROM files WHERE user_id = ${userId}) AS files,
      (SELECT count(*)::int FROM knowledge_chunk_embeddings WHERE user_id = ${userId}) AS knowledge_chunk_embeddings,
      (SELECT count(*)::int FROM knowledge_chunks WHERE user_id = ${userId}) AS knowledge_chunks,
      (SELECT count(*)::int FROM memory_extraction_runs WHERE user_id = ${userId}) AS memory_extraction_runs,
      (SELECT count(*)::int FROM memories WHERE user_id = ${userId}) AS memories,
      (SELECT count(*)::int FROM mcp_servers WHERE user_id = ${userId}) AS mcp_servers,
      (SELECT count(*)::int FROM mcp_tool_executions WHERE user_id = ${userId}) AS mcp_tool_executions,
      (SELECT count(*)::int FROM notes WHERE user_id = ${userId}) AS notes,
      (SELECT count(*)::int FROM onboarding_state WHERE user_id = ${userId}) AS onboarding_state,
      (SELECT count(*)::int FROM projects WHERE user_id = ${userId}) AS projects,
      (SELECT count(*)::int FROM provider_connections WHERE user_id = ${userId}) AS provider_connections,
      (SELECT count(*)::int FROM r2_upload_intents WHERE user_id = ${userId}) AS r2_upload_intents,
      (SELECT count(*)::int FROM skills WHERE user_id = ${userId}) AS skills,
      (SELECT count(*)::int FROM user_settings WHERE user_id = ${userId}) AS user_settings,
      (SELECT count(*)::int FROM users WHERE id = ${userId}) AS users
      ,(SELECT count(*)::int FROM usage_budget_accounts WHERE user_id = ${userId}) AS usage_budget_accounts
      ,(SELECT count(*)::int FROM usage_budget_transactions WHERE user_id = ${userId}) AS usage_budget_transactions
      ,(SELECT count(*)::int FROM usage_events WHERE user_id = ${userId}) AS usage_events
      ,(SELECT count(*)::int FROM usage_reservations WHERE user_id = ${userId}) AS usage_reservations
      ,(SELECT count(*)::int FROM webhook_subscriptions WHERE user_id = ${userId}) AS webhook_subscriptions
      ,(SELECT count(*)::int FROM webhook_deliveries WHERE user_id = ${userId}) AS webhook_deliveries
      ,(SELECT count(*)::int FROM webhook_delivery_attempts attempt JOIN webhook_deliveries delivery ON delivery.id = attempt.delivery_id WHERE delivery.user_id = ${userId}) AS webhook_delivery_attempts
  `)
  const row = result.rows[0]
  if (!row) return { ...ZERO_COUNTS }

  return {
    agentRuns: Number(row.agent_runs ?? 0),
    apiIdempotencyKeys: Number(row.api_idempotency_keys ?? 0),
    apiKeys: Number(row.api_keys ?? 0),
    administrativePrincipals: Number(row.administrative_principals ?? 0),
    automationRunAttempts: Number(row.automation_run_attempts ?? 0),
    automationRuns: Number(row.automation_runs ?? 0),
    automationTriggers: Number(row.automation_triggers ?? 0),
    automations: Number(row.automations ?? 0),
    billingSubscriptions: Number(row.billing_subscriptions ?? 0),
    billingTopUps: Number(row.billing_top_ups ?? 0),
    authIdentities: Number(row.auth_identities ?? 0),
    conversationContextSummaries: Number(row.conversation_context_summaries ?? 0),
    conversationEvents: Number(row.conversation_events ?? 0),
    conversationMessages: Number(row.conversation_messages ?? 0),
    conversations: Number(row.conversations ?? 0),
    daytonaWorkspaces: Number(row.daytona_workspaces ?? 0),
    files: Number(row.files ?? 0),
    knowledgeChunkEmbeddings: Number(row.knowledge_chunk_embeddings ?? 0),
    knowledgeChunks: Number(row.knowledge_chunks ?? 0),
    memoryExtractionRuns: Number(row.memory_extraction_runs ?? 0),
    memories: Number(row.memories ?? 0),
    mcpServers: Number(row.mcp_servers ?? 0),
    mcpToolExecutions: Number(row.mcp_tool_executions ?? 0),
    notes: Number(row.notes ?? 0),
    onboardingState: Number(row.onboarding_state ?? 0),
    projects: Number(row.projects ?? 0),
    providerConnections: Number(row.provider_connections ?? 0),
    r2UploadIntents: Number(row.r2_upload_intents ?? 0),
    skills: Number(row.skills ?? 0),
    userSettings: Number(row.user_settings ?? 0),
    users: Number(row.users ?? 0),
    usageBudgetAccounts: Number(row.usage_budget_accounts ?? 0),
    usageBudgetTransactions: Number(row.usage_budget_transactions ?? 0),
    usageEvents: Number(row.usage_events ?? 0),
    usageReservations: Number(row.usage_reservations ?? 0),
    webhookDeliveries: Number(row.webhook_deliveries ?? 0),
    webhookDeliveryAttempts: Number(row.webhook_delivery_attempts ?? 0),
    webhookSubscriptions: Number(row.webhook_subscriptions ?? 0),
  }
}

function sumCounts(counts: AccountDataDeletionCounts): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}
