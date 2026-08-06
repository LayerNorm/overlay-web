import type { NextRequest } from 'next/server'
import { handleBffRoute } from '../../_utils/bff'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, async (req, context) => {
    // User auth required (any logged-in user can trigger this one-time migration)
    if (!context?.auth.userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { getOverlayServerContext } = await import('@/server/bootstrap')
    const ctx = getOverlayServerContext()
    const db = (ctx.appData as { db?: { execute: (sql: string) => Promise<unknown> } }).db
    if (!db?.execute) {
      return Response.json({ error: 'No DB access' }, { status: 500 })
    }
    try {
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
  })
}
