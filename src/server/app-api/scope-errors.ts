import { NextResponse } from 'next/server'
import { scopeErrorMessage } from '@/shared/workspaces/resource-scope'

const PREFIX = 'RESOURCE_SCOPE_FORBIDDEN:'

/**
 * Convex rejects creating a workspace-scoped item the member may not create with
 * `RESOURCE_SCOPE_FORBIDDEN:<reason>`. Returns a 403 with a plain message for that, or null for any other error.
 */
export function scopeForbiddenResponse(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : ''
  const index = message.indexOf(PREFIX)
  if (index < 0) return null
  const reason = message.slice(index + PREFIX.length).split(/[\s\n]/)[0] ?? ''
  const text = reason === 'workspace_required' ? 'Choose a workspace first.' : scopeErrorMessage(reason)
  return NextResponse.json({ error: text, code: 'resource_scope_forbidden', reason }, { status: 403 })
}
