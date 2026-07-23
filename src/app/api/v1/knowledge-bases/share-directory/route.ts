import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { knowledgeBaseErrorResponse } from '@/server/app-api/v1/knowledge-bases/errors'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

const listDirectory: BffDomainService = async (_request, context) => {
  try {
    return NextResponse.json(await getOverlayServerContext().knowledgeBaseService
      .listShareDirectory(context.auth.userId))
  } catch (error) {
    return knowledgeBaseErrorResponse('share-directory', error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listDirectory)
}
