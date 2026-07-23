import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse } from './errors'

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    return NextResponse.json({
      knowledgeBases: await getOverlayServerContext().knowledgeBaseService
        .listKnowledgeBases(context.auth.userId),
    })
  } catch (error) {
    return knowledgeBaseErrorResponse('list', error)
  }
}

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as {
      title: string
      description?: string
      kind?: 'personal' | 'organization'
    }
    const knowledgeBase = await getOverlayServerContext().knowledgeBaseService.createKnowledgeBase({
      ...body,
      userId: context.auth.userId,
    })
    return NextResponse.json({ knowledgeBase }, { status: 201 })
  } catch (error) {
    return knowledgeBaseErrorResponse('create', error)
  }
}

export async function PATCH(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as {
      knowledgeBaseId: string
      title?: string
      description?: string
      kind?: 'personal' | 'organization'
    }
    const knowledgeBase = await getOverlayServerContext().knowledgeBaseService.updateKnowledgeBase({
      ...body,
      userId: context.auth.userId,
    })
    return NextResponse.json({ knowledgeBase })
  } catch (error) {
    return knowledgeBaseErrorResponse('update', error)
  }
}

export async function DELETE(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const { knowledgeBaseId } = context.parsedJson as { knowledgeBaseId: string }
    await getOverlayServerContext().knowledgeBaseService.deleteKnowledgeBase({
      knowledgeBaseId,
      userId: context.auth.userId,
    })
    return NextResponse.json({ deleted: true, knowledgeBaseId })
  } catch (error) {
    return knowledgeBaseErrorResponse('delete', error)
  }
}
