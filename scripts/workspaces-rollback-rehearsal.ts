/**
 * Phase 8 migration rollback rehearsal.
 *
 * Proves that the collaboration schema can be rolled back to the previous
 * runtime without losing messages, memberships, or grants:
 *
 *  1. Counts the collaboration state that must survive.
 *  2. Confirms the previous runtime is still compatible with this database.
 *  3. Rolls the Phase 8 policy columns and governance tables back inside a
 *     transaction, re-counts, and then rolls the transaction back so the
 *     rehearsal itself changes nothing.
 *
 * Usage: tsx --env-file=.env.app-data.local scripts/workspaces-rollback-rehearsal.ts
 */
import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import {
  APP_DATA_MINIMUM_SCHEMA_VERSION,
  APP_DATA_SCHEMA_VERSION,
  evaluateAppDataSchemaCompatibility,
  readAppDataSchemaCompatibility,
} from '../src/server/database/postgres/schema-compatibility'

type Counts = {
  conversations: number
  messages: number
  memberships: number
  grants: number
  guests: number
}

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 3,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const failures: string[] = []
  let scratch: string | null = null
  try {
    const compatibility = await readAppDataSchemaCompatibility(pool)
    if (!compatibility.compatible) throw new Error('Runtime is not compatible with this database')
    if (compatibility.databaseSchemaVersion !== APP_DATA_SCHEMA_VERSION) {
      throw new Error(
        `Database is at schema ${compatibility.databaseSchemaVersion}, expected ${APP_DATA_SCHEMA_VERSION}`,
      )
    }

    // Seed a scratch workspace so the rehearsal proves data survives a rollback
    // instead of trivially comparing zeros. It is removed in the finally block.
    scratch = await seedScratchWorkspace(db)
    const before = await readCounts(db)
    if (before.messages === 0 || before.grants === 0 || before.memberships === 0) {
      failures.push('rehearsal seed did not produce collaboration rows to protect')
    }

    // The previous runtime must still accept this database, otherwise a rollback
    // would strand the deployment.
    const previousRuntime = evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: APP_DATA_MINIMUM_SCHEMA_VERSION - 1,
      databaseSchemaVersion: APP_DATA_SCHEMA_VERSION - 1,
      runtimeMaximumSchemaVersion: APP_DATA_SCHEMA_VERSION - 1,
      runtimeMinimumSchemaVersion: APP_DATA_MINIMUM_SCHEMA_VERSION - 1,
    })
    if (!previousRuntime.compatible) failures.push('previous runtime rejected the rolled-back schema')

    // Rehearse the rollback inside a transaction that always aborts.
    let after: Counts | null = null
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP TABLE IF EXISTS workspace_audit_exports`)
      await tx.execute(sql`DROP TABLE IF EXISTS workspace_identity_mappings`)
      await tx.execute(sql`
        ALTER TABLE workspace_sharing_policies
          DROP COLUMN IF EXISTS member_can_create_channels,
          DROP COLUMN IF EXISTS member_can_create_agents,
          DROP COLUMN IF EXISTS member_can_invite,
          DROP COLUMN IF EXISTS guest_expiration_days,
          DROP COLUMN IF EXISTS allowed_agent_harnesses,
          DROP COLUMN IF EXISTS agent_run_budget_cents,
          DROP COLUMN IF EXISTS channel_retention_days,
          DROP COLUMN IF EXISTS legal_hold,
          DROP COLUMN IF EXISTS data_residency,
          DROP COLUMN IF EXISTS rollout_stage
      `)
      await tx.execute(sql`
        UPDATE overlay_app_data_metadata SET value = '37'
        WHERE key = 'schema_version'
      `)
      after = await readCounts(tx as unknown as OverlayDb)
      // Abort: the rehearsal must leave the database exactly as it was.
      throw new RollbackRehearsalComplete()
    }).catch((error: unknown) => {
      if (!(error instanceof RollbackRehearsalComplete)) throw error
    })

    if (!after) failures.push('rollback rehearsal produced no post-rollback counts')
    else {
      for (const key of ['conversations', 'messages', 'memberships', 'grants', 'guests'] as const) {
        if (after[key] !== before[key]) {
          failures.push(`${key} changed during rollback: ${before[key]} -> ${after[key]}`)
        }
      }
    }

    const restored = await readCounts(db)
    for (const key of ['conversations', 'messages', 'memberships', 'grants', 'guests'] as const) {
      if (restored[key] !== before[key]) failures.push(`${key} not restored after rehearsal`)
    }
    const schemaAfter = await readAppDataSchemaCompatibility(pool)
    if (schemaAfter.databaseSchemaVersion !== APP_DATA_SCHEMA_VERSION) {
      failures.push('schema version was not restored after the rehearsal')
    }

    console.log(JSON.stringify({
      ok: failures.length === 0,
      schemaVersion: schemaAfter.databaseSchemaVersion,
      before,
      afterRollback: after,
      restored,
      failures,
    }, null, 2))
    if (failures.length > 0) process.exitCode = 1
  } finally {
    if (scratch) {
      await db.execute(sql`DELETE FROM workspaces WHERE id LIKE ${`${scratch}%`}`).catch(() => undefined)
      await db.execute(sql`DELETE FROM users WHERE id LIKE ${`${scratch}%`}`).catch(() => undefined)
    }
    await pool.end()
  }
}

/**
 * Minimal but complete slice: a workspace, a human principal and membership, a
 * channel with one message, a resource grant, and a guest grant.
 */
async function seedScratchWorkspace(db: OverlayDb): Promise<string> {
  const scope = `rehearsal_${Date.now().toString(36)}`
  await db.execute(sql`
    INSERT INTO users (id, email, email_verified)
    VALUES
      (${`${scope}_user`}, ${`${scope}@example.com`}, true),
      (${`${scope}_guest_user`}, ${`${scope}-guest@example.com`}, true)
  `)
  await db.execute(sql`
    INSERT INTO workspaces (id, kind, name, slug, status, created_at, updated_at)
    VALUES (${scope}, 'organization', ${`Rehearsal ${scope}`}, ${scope}, 'active', now(), now())
  `)
  await db.execute(sql`
    INSERT INTO workspace_principals (id, workspace_id, type, user_id, display_name, created_at, updated_at)
    VALUES (${`${scope}_principal`}, ${scope}, 'human', ${`${scope}_user`}, 'Rehearsal owner', now(), now())
  `)
  await db.execute(sql`
    INSERT INTO workspace_memberships (workspace_id, principal_id, role, status, joined_at, updated_at)
    VALUES (${scope}, ${`${scope}_principal`}, 'owner', 'active', now(), now())
  `)
  await db.execute(sql`
    INSERT INTO workspace_principals (id, workspace_id, type, user_id, display_name, created_at, updated_at)
    VALUES (${`${scope}_guest_principal`}, ${scope}, 'human', ${`${scope}_guest_user`}, 'Rehearsal guest', now(), now())
  `)
  await db.execute(sql`
    INSERT INTO workspace_memberships (workspace_id, principal_id, role, status, joined_at, updated_at)
    VALUES (${scope}, ${`${scope}_guest_principal`}, 'guest', 'active', now(), now())
  `)
  await db.execute(sql`
    INSERT INTO conversations (
      id, user_id, workspace_id, conversation_type, created_by_principal_id, title,
      channel_slug, channel_visibility,
      last_mode, ask_model_ids, act_model_id, created_at, updated_at, last_modified
    ) VALUES (
      ${`${scope}_conversation`}, ${`${scope}_user`}, ${scope}, 'channel',
      ${`${scope}_principal`}, 'rehearsal-channel', ${`${scope}-channel`}, 'private',
      'ask', '[]'::jsonb, 'model', now(), now(), now()
    )
  `)
  await db.execute(sql`
    INSERT INTO conversation_messages (
      id, conversation_id, user_id, turn_id, role, mode, author_kind, author_principal_id,
      content, content_type, created_at
    ) VALUES (
      ${`${scope}_message`}, ${`${scope}_conversation`}, ${`${scope}_user`}, ${`${scope}_turn`},
      'user', 'ask', 'human', ${`${scope}_principal`}, 'rehearsal message', 'text', now()
    )
  `)
  await db.execute(sql`
    INSERT INTO workspace_resource_scopes (workspace_id, resource_type, resource_id, created_at, updated_at)
    VALUES (${scope}, 'conversation', ${`${scope}_conversation`}, now(), now())
  `)
  await db.execute(sql`
    INSERT INTO workspace_resource_grants (
      id, workspace_id, resource_type, resource_id, target_type, target_id, access_role,
      granted_by_principal_id, created_at, updated_at
    ) VALUES (
      ${`${scope}_grant`}, ${scope}, 'conversation', ${`${scope}_conversation`}, 'principal',
      ${`${scope}_guest_principal`}, 'viewer', ${`${scope}_principal`}, now(), now()
    )
  `)
  await db.execute(sql`
    INSERT INTO workspace_resource_guests (
      id, workspace_id, resource_type, resource_id, principal_id, access_role, status,
      granted_by_principal_id, created_at, updated_at
    ) VALUES (
      ${`${scope}_guest`}, ${scope}, 'conversation', ${`${scope}_conversation`},
      ${`${scope}_guest_principal`}, 'viewer', 'active', ${`${scope}_principal`}, now(), now()
    )
  `)
  return scope
}

class RollbackRehearsalComplete extends Error {}

type OverlayDb = ReturnType<typeof createOverlayPostgresDb>

async function readCounts(db: OverlayDb): Promise<Counts> {
  const result = await db.execute<{
    conversations: string
    messages: string
    memberships: string
    grants: string
    guests: string
  }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM conversations) AS conversations,
      (SELECT COUNT(*)::text FROM conversation_messages) AS messages,
      (SELECT COUNT(*)::text FROM workspace_memberships) AS memberships,
      (SELECT COUNT(*)::text FROM workspace_resource_grants) AS grants,
      (SELECT COUNT(*)::text FROM workspace_resource_guests) AS guests
  `)
  const row = result.rows[0]
  return {
    conversations: Number.parseInt(row?.conversations ?? '0', 10),
    messages: Number.parseInt(row?.messages ?? '0', 10),
    memberships: Number.parseInt(row?.memberships ?? '0', 10),
    grants: Number.parseInt(row?.grants ?? '0', 10),
    guests: Number.parseInt(row?.guests ?? '0', 10),
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
