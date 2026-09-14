import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import {
  workspaceMemberships,
  workspacePrincipals,
} from '@/server/database/postgres/schema'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { OverlayServerContext } from '@/server/bootstrap'

export type ImportedAuthorStatus = 'member' | 'invited' | 'not_invited'

/**
 * Resolve a surface sender's Overlay workspace-membership status from their
 * platform email — the same convention the Slack importer uses, so imported
 * and live inbound messages render identically. Convex delegates to the
 * importer's resolver (which knows invitations); the Postgres schema has no
 * invitations table yet, so it reports member vs not_invited.
 */
export async function resolveSurfaceAuthorStatus(args: {
  context: OverlayServerContext
  workspaceId: string
  email?: string
}): Promise<ImportedAuthorStatus | undefined> {
  const email = args.email?.toLowerCase().trim()
  if (!email) return 'not_invited'
  try {
    if (args.context.appDataCapabilities.provider === 'postgres') {
      const db = args.context.appData.postgres?.db
      if (!db) return 'not_invited'
      const [member] = await db
        .select({ principalId: workspacePrincipals.id })
        .from(workspacePrincipals)
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
            eq(workspaceMemberships.principalId, workspacePrincipals.id),
          ),
        )
        .where(and(
          eq(workspacePrincipals.workspaceId, args.workspaceId),
          eq(workspacePrincipals.email, email),
          isNull(workspacePrincipals.archivedAt),
          eq(workspaceMemberships.status, 'active'),
        ))
        .limit(1)
      return member ? 'member' : 'not_invited'
    }
    const rows = await convex.query<Array<{ email: string; status: ImportedAuthorStatus }>>(
      'imports/slackImporter:resolveAuthorStatuses',
      {
        workspaceId: args.workspaceId,
        emails: [email],
        serverSecret: getInternalApiSecret(),
      },
    )
    return rows?.find((row) => row.email === email)?.status ?? 'not_invited'
  } catch (error) {
    // Status is display metadata — never block the turn on a lookup failure.
    logger.warn('[surfaces] author status resolution failed', {
      workspaceId: args.workspaceId,
      error: summarizeErrorForLog(error),
    })
    return undefined
  }
}
