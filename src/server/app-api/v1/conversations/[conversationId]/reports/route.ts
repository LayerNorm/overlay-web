import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

const REPORT_REASONS = ['abuse', 'spam', 'sensitive_data', 'other'] as const
type ReportReason = (typeof REPORT_REASONS)[number]

/**
 * Moderation intake hook. A report is recorded as a durable audit event only —
 * there is deliberately no queue, no visible moderation state, and no effect on
 * the reported message until a later phase defines review and appeal policy.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  const params = await context.params
  const conversationId = typeof params.conversationId === 'string'
    ? params.conversationId
    : params.conversationId?.[0]
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }
  const serverContext = getOverlayServerContext()
  const workspaceId = context.workspace.workspace.id
  const canAccess = await serverContext.appData.repositories.conversationCollaboration
    .canAccessConversation({
      actorUserId: context.auth.userId,
      conversationId,
      workspaceId,
    })
  if (!canAccess) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const reason = parseReason(context.parsedJson.reason)
  const messageId = typeof context.parsedJson.messageId === 'string'
    ? context.parsedJson.messageId.trim()
    : undefined
  const note = typeof context.parsedJson.note === 'string'
    ? context.parsedJson.note.trim().slice(0, 1_000)
    : undefined

  await serverContext.auditService.record({
    action: 'conversation.message.reported',
    actorType: 'user',
    actorUserId: context.auth.userId,
    outcome: 'success',
    resourceType: 'conversation',
    resourceId: conversationId,
    metadata: {
      workspaceId,
      reason,
      ...(messageId ? { messageId } : {}),
      // The note is reporter-authored text; it is stored verbatim for review and
      // never rendered back into the room.
      ...(note ? { note } : {}),
    },
  })
  return NextResponse.json({ recorded: true })
}

function parseReason(value: unknown): ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)
    ? value as ReportReason
    : 'other'
}
