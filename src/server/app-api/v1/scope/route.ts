import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { parseResourceScope, scopeErrorMessage } from '@/shared/workspaces/resource-scope'

/** The Convex module behind each kind of scoped resource. Notes, outputs, and uploads are all `files`. */
const MODULES = {
  files: 'files/files',
  skills: 'integrations/skills',
  'mcp-servers': 'integrations/mcpServers',
  connectors: 'integrations/workspaceConnectors',
  automations: 'automations/automations',
} as const

type Resource = keyof typeof MODULES
type Action = 'move' | 'archive' | 'restore'
type Outcome = { ok: true } | { ok: false; reason: string }

function isResource(value: unknown): value is Resource {
  return typeof value === 'string' && Object.hasOwn(MODULES, value)
}

function isAction(value: unknown): value is Action {
  return value === 'move' || value === 'archive' || value === 'restore'
}

function statusFor(reason: string): number {
  if (reason === 'not_found') return 404
  if (reason === 'same_scope' || reason === 'already_archived' || reason === 'not_archived' || reason === 'archived') return 409
  return 403
}

/**
 * POST /api/v1/scope: move a resource between Personal and Workspace, archive it, or restore it.
 * Body: `{ resource, id, action: 'move' | 'archive' | 'restore', to?: 'personal' | 'workspace' }`.
 * The rules (who may do what) are enforced in Convex; this only translates the outcome to HTTP.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json()
    const { resource, id, action } = body as Record<string, unknown>
    if (!isResource(resource) || typeof id !== 'string' || !id || !isAction(action)) {
      return NextResponse.json({ error: 'resource, id, and action (move, archive, restore) are required' }, { status: 400 })
    }
    const to = parseResourceScope(body.to)
    if (action === 'move' && !to) {
      return NextResponse.json({ error: "move needs `to`: 'personal' or 'workspace'" }, { status: 400 })
    }
    const fn = action === 'move' ? 'setScope' : action
    const outcome = await convex.mutation<Outcome>(`${MODULES[resource]}:${fn}`, {
      id,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      serverSecret: getInternalApiSecret(),
      ...(action === 'move' ? { to } : {}),
    }, { throwOnError: true })
    if (!outcome) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    await recordScopeAudit({ context, resource, id, action, to, outcome })
    if (!outcome.ok) {
      return NextResponse.json(
        { error: scopeErrorMessage(outcome.reason), code: 'resource_scope_denied', reason: outcome.reason },
        { status: statusFor(outcome.reason) },
      )
    }
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

/** Moves, archives, and restores go in the workspace's audit log (best effort: a logging failure never undoes the change). */
async function recordScopeAudit(args: {
  context: AppApiRouteContext
  resource: Resource
  id: string
  action: Action
  to: string | undefined
  outcome: Outcome
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
