import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  handleSandboxRunPost,
  SANDBOX_MAX_DURATION_SECONDS,
} from './handler'

export const maxDuration = SANDBOX_MAX_DURATION_SECONDS

export function POST(request: NextRequest, context: AppApiRouteContext) {
  return handleSandboxRunPost(request, context)
}
