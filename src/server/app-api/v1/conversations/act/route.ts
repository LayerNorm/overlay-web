import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { executeActTurn } from './ActTurnOrchestrationService'

export type { ActRouteDependencies } from './ActTurnOrchestrationService'
import type { ActRouteDependencies } from './ActTurnOrchestrationService'

export const maxDuration = 800

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies: ActRouteDependencies = {},
) {
  return executeActTurn(request, context, dependencies)
}
