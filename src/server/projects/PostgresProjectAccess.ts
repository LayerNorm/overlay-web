import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { projects } from '@/server/database/postgres/schema'

export async function assertActivePostgresProject(
  db: Pick<OverlayPostgresDb, 'select'>,
  args: {
    projectId?: string | null
    userId: string
  },
): Promise<void> {
  if (!args.projectId) return
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.id, args.projectId),
      eq(projects.userId, args.userId),
      isNull(projects.archivedAt),
      isNull(projects.deletedAt),
    ))
    .limit(1)
  if (!project) throw new Error('Unauthorized')
}
