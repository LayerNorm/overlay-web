import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { OverlayServerContext } from '@/server/bootstrap'

export type ImportedAuthorStatus = 'member' | 'invited' | 'not_invited'

/**
 * Resolve a surface sender's Overlay workspace-membership status from their
 * platform email — the same convention the Slack importer uses, so imported
 * and live inbound messages render identically, by delegating to the
 * importer's resolver (which knows invitations).
 */
export async function resolveSurfaceAuthorStatus(args: {
  context: OverlayServerContext
  workspaceId: string
  email?: string
}): Promise<ImportedAuthorStatus | undefined> {
  const email = args.email?.toLowerCase().trim()
  if (!email) return 'not_invited'
  try {
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
