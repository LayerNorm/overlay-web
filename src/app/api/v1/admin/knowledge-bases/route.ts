import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { knowledgeBaseErrorResponse } from '@/server/app-api/v1/knowledge-bases/errors'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

const listKnowledgeBases: BffDomainService = async (_request, context) => {
  try {
    return NextResponse.json({
      knowledgeBases: await getOverlayServerContext().knowledgeBaseService
        .listAdministrativeKnowledgeBases(context.auth.userId),
    })
  } catch (error) {
    return knowledgeBaseErrorResponse('admin-list', error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listKnowledgeBases)
}
