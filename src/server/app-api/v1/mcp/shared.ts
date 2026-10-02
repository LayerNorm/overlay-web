import { NextResponse } from 'next/server'
import { McpOAuthError } from '@/server/mcp/McpAccessService'
import { logger } from '@/server/observability/logger'

export const NO_STORE = { 'Cache-Control': 'no-store' }

export function mcpRouteError(error: unknown): Response {
  if (error instanceof McpOAuthError) {
    return NextResponse.json({ error: error.message, code: error.error }, { status: error.statusCode, headers: NO_STORE })
  }
  logger.error('[mcp] request failed', { error: error instanceof Error ? error.name : 'unknown' })
  return NextResponse.json({ error: 'Could not complete the request', code: 'internal_error' }, { status: 500, headers: NO_STORE })
}
