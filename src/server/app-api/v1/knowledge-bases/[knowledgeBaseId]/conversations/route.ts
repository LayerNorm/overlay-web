import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import type { Id } from '../../../../../../../convex/_generated/dataModel'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const server = getOverlayServerContext()
    const attachments = await server.knowledgeBaseService.listUserConversationAttachments({
      knowledgeBaseId,
      userId: getAuthorizedResourceUserId(context),
    })
    const conversations = (await Promise.all(attachments.map(({ conversationId }) => (
      server.appData.repositories.conversations.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: getAuthorizedResourceUserId(context),
      })
    )))).filter(Boolean)
    return NextResponse.json({ conversations })
  } catch (error) {
    return knowledgeBaseErrorResponse('list conversations for', error)
  }
}
