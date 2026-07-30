/**
 * Channel retention sweep.
 *
 * Reports, and with --apply deletes, channel messages older than each
 * workspace's retention window. Legal hold always wins: a workspace under hold
 * is skipped even when a retention window is configured. Dry run is the default
 * so an operator always sees the effect before anything is removed.
 *
 * Usage:
 *   tsx --env-file=.env.app-data.local scripts/workspace-retention-sweep.ts [--apply] [--limit=500]
 */
import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

type RetentionRow = {
  workspaceId: string
  name: string
  channelRetentionDays: number
  legalHold: boolean
}

const apply = process.argv.includes('--apply')
const limitArg = process.argv.find((argument) => argument.startsWith('--limit='))
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : 1_000

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    const policies = await db.execute<RetentionRow>(sql`
      SELECT policy.workspace_id AS "workspaceId", workspace.name,
             policy.channel_retention_days AS "channelRetentionDays",
             policy.legal_hold AS "legalHold"
      FROM workspace_sharing_policies policy
      JOIN workspaces workspace ON workspace.id = policy.workspace_id
      WHERE policy.channel_retention_days IS NOT NULL
      ORDER BY policy.workspace_id
    `)
    const summary: Array<Record<string, unknown>> = []
    for (const row of policies.rows) {
      if (row.legalHold) {
        summary.push({
          workspaceId: row.workspaceId,
          workspace: row.name,
          skipped: 'legal_hold',
          retentionDays: row.channelRetentionDays,
        })
        continue
      }
      const cutoff = new Date(Date.now() - row.channelRetentionDays * 24 * 60 * 60 * 1_000)
      const candidates = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM conversation_messages message
        JOIN conversations conversation ON conversation.id = message.conversation_id
        WHERE conversation.workspace_id = ${row.workspaceId}
          AND conversation.conversation_type = 'channel'
          AND message.created_at < ${cutoff}
          AND message.deleted_at IS NULL
      `)
      const pending = Number.parseInt(candidates.rows[0]?.count ?? '0', 10)
      let deleted = 0
      if (apply && pending > 0) {
        // Tombstone rather than hard delete so transcript ordering and audit
        // references survive; hard erasure is a separate, explicit operation.
        const result = await db.execute<{ id: string }>(sql`
          UPDATE conversation_messages
          SET deleted_at = now()
          WHERE id IN (
            SELECT message.id
            FROM conversation_messages message
            JOIN conversations conversation ON conversation.id = message.conversation_id
            WHERE conversation.workspace_id = ${row.workspaceId}
              AND conversation.conversation_type = 'channel'
              AND message.created_at < ${cutoff}
              AND message.deleted_at IS NULL
            LIMIT ${limit}
          )
          RETURNING id
        `)
        deleted = result.rows.length
      }
      summary.push({
        workspaceId: row.workspaceId,
        workspace: row.name,
        retentionDays: row.channelRetentionDays,
        cutoff: cutoff.toISOString(),
        pending,
        deleted,
      })
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', workspaces: summary }, null, 2))
  } finally {
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
