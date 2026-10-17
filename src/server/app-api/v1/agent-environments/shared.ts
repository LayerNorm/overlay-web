import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ConnectedAgentControlPlaneError } from '@/server/agents'
import { describeFailure } from '@/server/observability/failure-classification'
import { logger } from '@/server/observability/logger'

export function agentEnvironmentErrorResponse(error: unknown) {
  if (error instanceof ConnectedAgentControlPlaneError) {
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.statusCode,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid request', code: 'validation_error', issues: error.issues }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  // The message is not logged (it can carry user data); its classification names the cause.
  logger.error('[agent-environments] request failed', describeFailure(error))
  return NextResponse.json({ error: 'Agent environment request failed', code: 'internal_error' }, {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function environmentIdFrom(context: { params: Promise<Record<string, string | string[]>> }) {
  const value = (await context.params).environmentId
  const environmentId = typeof value === 'string' ? value.trim() : ''
  if (!environmentId) throw new ConnectedAgentControlPlaneError('Environment id is required', 400, 'environment_id_required')
  return environmentId
}
