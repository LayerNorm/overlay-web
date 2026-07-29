import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { knowledgeBaseErrorResponse } from '@/server/app-api/v1/knowledge-bases/errors'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'

const listDefaults: BffDomainService = async (_request, context) => {
  try {
    return NextResponse.json({
      defaults: await getOverlayServerContext().knowledgeBaseService.listGroupDefaults({
        groupId: typeof context.parsedQuery.groupId === 'string'
          ? context.parsedQuery.groupId
          : undefined,
        userId: context.auth.userId,
      }),
    })
  } catch (error) {
    return knowledgeBaseErrorResponse('list group defaults for', error)
  }
}

const setDefault: BffDomainService = async (_request, context) => {
  try {
    const input = context.parsedJson as { groupId: string; knowledgeBaseId: string }
    return NextResponse.json(await getOverlayServerContext().knowledgeBaseService.setGroupDefault({
      ...input,
      userId: context.auth.userId,
    }), { status: 201 })
  } catch (error) {
    return knowledgeBaseErrorResponse('set group default for', error)
  }
}

const removeDefault: BffDomainService = async (_request, context) => {
  try {
    const input = context.parsedJson as { groupId: string; knowledgeBaseId: string }
    await getOverlayServerContext().knowledgeBaseService.removeGroupDefault({
      ...input,
      userId: context.auth.userId,
    })
    return NextResponse.json({ removed: true })
  } catch (error) {
    return knowledgeBaseErrorResponse('remove group default from', error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listDefaults)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, setDefault)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, removeDefault)
}
