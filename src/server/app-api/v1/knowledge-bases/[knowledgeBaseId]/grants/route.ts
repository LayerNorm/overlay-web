import type { AuthorizationPrincipalType, ResourceAccessRole } from '@overlay/authz-contracts'
import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    return NextResponse.json({
      grants: await getOverlayServerContext().knowledgeBaseService.listShares({
        knowledgeBaseId,
        userId: context.auth.userId,
      }),
    })
  } catch (error) {
    return knowledgeBaseErrorResponse('list shares for', error)
  }
}

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as {
      accessRole: Exclude<ResourceAccessRole, 'owner'>
      principalId: string
      principalType: AuthorizationPrincipalType
    }
    const grant = await getOverlayServerContext().knowledgeBaseService.shareKnowledgeBase({
      ...body,
      knowledgeBaseId,
      userId: context.auth.userId,
    })
    return NextResponse.json({ grant }, { status: 201 })
  } catch (error) {
    return knowledgeBaseErrorResponse('share', error)
  }
}

export async function DELETE(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const { grantId } = context.parsedJson as { grantId: string }
    await getOverlayServerContext().knowledgeBaseService.revokeKnowledgeBaseShare({
      grantId,
      knowledgeBaseId,
      userId: context.auth.userId,
    })
    return NextResponse.json({ removed: true, grantId })
  } catch (error) {
    return knowledgeBaseErrorResponse('revoke share for', error)
  }
}
