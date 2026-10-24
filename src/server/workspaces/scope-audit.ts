import 'server-only'

import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'

/** Audit scope requests without turning a logging failure into a failed resource change. */
export async function recordScopeAudit(args: {
  context: AppApiRouteContext
  resource: string
  id: string
  action: 'move' | 'archive' | 'restore'
  to: string | undefined
  outcome: { ok: true } | { ok: false; reason: string }
}) {
  try {
    await getOverlayServerContext().appData.repositories.audit.append({
      action: `resource.${args.action}`,
      actorType: 'user',
      actorUserId: args.context.auth.userId,
      outcome: args.outcome.ok ? 'success' : 'denied',
      resourceType: args.resource,
      resourceId: args.id,
      metadata: {
        workspaceId: args.context.workspace.workspace.id,
        ...(args.to ? { to: args.to } : {}),
        ...(args.outcome.ok ? {} : { reason: args.outcome.reason }),
      },
    })
  } catch (error) {
    logger.warn('[scope] audit event not recorded', error)
  }
}
