import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getWorkService } from '@/server/work'
import { OnboardingActionSchema } from '@/shared/onboarding/session'
import { ConvexOnboardingStateRepository, ConversationalOnboardingService, OnboardingServiceError } from '@/server/onboarding'
import { ONBOARDING_SEEN_COOKIE } from '@/features/auth/lib/onboarding-cookie'
import { createOnboardingReplyGenerator } from '@/server/onboarding/OnboardingReplyGenerator'

function service(context: AppApiRouteContext) {
  const server = getOverlayServerContext()
  return new ConversationalOnboardingService({
    repository: new ConvexOnboardingStateRepository(),
    reply: createOnboardingReplyGenerator(context),
    effects: {
      agents: server.workspaceAgentService,
      collaboration: server.appData.repositories.conversationCollaboration,
      memories: server.memoryService,
      work: getWorkService(),
      workspaces: server.workspaceService,
    },
  })
}

function errorResponse(error: unknown) {
  if (error instanceof OnboardingServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  return NextResponse.json({ error: 'Onboarding request failed', code: 'onboarding_failed' }, { status: 500 })
}

function responseWithCompletionCookie(result: Awaited<ReturnType<ConversationalOnboardingService['get']>>, userId: string) {
  const response = NextResponse.json(result)
  if (result.completed) {
    response.cookies.set(ONBOARDING_SEEN_COOKIE, userId, {
      path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
    })
  }
  return response
}

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const result = await service(context).get(context.auth.userId, context.workspace.workspace.id)
    return responseWithCompletionCookie(result, context.auth.userId)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = OnboardingActionSchema.safeParse(context.parsedJson)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid onboarding action', code: 'validation_error' }, { status: 400 })
    const onboarding = service(context)
    if (parsed.data.action === 'start') {
      const result = await onboarding.start(context.auth.userId, context.workspace.workspace.id)
      return responseWithCompletionCookie(result, context.auth.userId)
    }
    const result = await onboarding.act(context.auth.userId, context.workspace.workspace.id, parsed.data)
    return responseWithCompletionCookie(result, context.auth.userId)
  } catch (error) {
    return errorResponse(error)
  }
}
