import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const sources = await getOverlayServerContext().knowledgeBaseService.listSources({
      knowledgeBaseId,
      userId: context.auth.userId,
    })
    return NextResponse.json({ sources: sources.map(summarizeSourceDetail) })
  } catch (error) {
    return knowledgeBaseErrorResponse('list sources for', error)
  }
}

function summarizeSourceDetail<T extends { source: { metadata: Record<string, unknown> } }>(detail: T) {
  const content = typeof detail.source.metadata.content === 'string'
    ? detail.source.metadata.content
    : ''
  const { content: _content, ...metadata } = detail.source.metadata
  void _content
  return {
    ...detail,
    source: {
      ...detail.source,
      metadata,
      ...(content ? { contentPreview: content.slice(0, 8000) } : {}),
    },
  }
}

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as {
      title: string
      content: string
      mimeType?: string
      sourceRef?: string
    }
    const result = await getOverlayServerContext().knowledgeSourceIngestionService.createTextSource({
      ...body,
      knowledgeBaseId,
      userId: context.auth.userId,
    })
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    return knowledgeBaseErrorResponse('create source for', error)
  }
}

export async function PATCH(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as {
      sourceId: string
      content?: string
      enabled?: boolean
      retry?: boolean
    }
    const server = getOverlayServerContext()
    if (body.content !== undefined) {
      return NextResponse.json(await server.knowledgeSourceIngestionService.replaceTextSource({
        content: body.content,
        sourceId: body.sourceId,
        userId: context.auth.userId,
      }), { status: 202 })
    }
    if (body.retry) {
      return NextResponse.json({
        jobId: await server.knowledgeSourceIngestionService.retry({
          sourceId: body.sourceId,
          userId: context.auth.userId,
        }),
      }, { status: 202 })
    }
    if (body.enabled !== undefined) {
      await server.knowledgeBaseService.setSourceEnabled({
        enabled: body.enabled,
        knowledgeBaseId,
        sourceId: body.sourceId,
        userId: context.auth.userId,
      })
      return NextResponse.json({ updated: true })
    }
    return NextResponse.json({ error: 'content, retry, or enabled is required' }, { status: 400 })
  } catch (error) {
    return knowledgeBaseErrorResponse('update source for', error)
  }
}

export async function DELETE(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as { sourceId: string; deleteCanonical?: boolean }
    const server = getOverlayServerContext()
    if (body.deleteCanonical) {
      await server.knowledgeSourceIngestionService.delete({
        sourceId: body.sourceId,
        userId: context.auth.userId,
      })
    } else {
      await server.knowledgeBaseService.removeSource({
        knowledgeBaseId,
        sourceId: body.sourceId,
        userId: context.auth.userId,
      })
    }
    return NextResponse.json({ deleted: true, sourceId: body.sourceId })
  } catch (error) {
    return knowledgeBaseErrorResponse('delete source from', error)
  }
}
