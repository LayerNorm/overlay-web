import type { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  // One-time migration endpoint — bypasses BFF authorization policy.
  // Protected by the session cookie (any logged-in user can trigger it).
  // Delete this file after the migration has been applied.
  try {
    const ctx = getOverlayServerContext()
    const db = (ctx.appData as { db?: { execute: (sql: string) => Promise<unknown> } }).db
    if (!db?.execute) {
      return Response.json({ error: 'No DB access' }, { status: 500 })
    }
    await db.execute(
      `ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "scheduler_workflow_run_id" text`,
    )
    await db.execute(
      `INSERT INTO overlay_app_data_metadata (key, value, updated_at)
       VALUES ('schema_version', '45', now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    return Response.json({ ok: true, migrated: true })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 },
    )
  }
}
