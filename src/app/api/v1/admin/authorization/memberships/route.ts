import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listMembers: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ memberships: await authorizationAdministrationService().listGroupMembers(
      authorizationActor(request, context),
      context.parsedQuery.groupId as string,
    ) })
  } catch (error) {
    return respond(error, request, context, 'list')
  }
}

const addMember: BffDomainService = async (request, context) => {
  try {
    const membership = await authorizationAdministrationService().addGroupMember(
      authorizationActor(request, context),
      {
        groupId: context.parsedJson.groupId as string,
        userId: context.parsedJson.userId as string,
      },
    )
    return NextResponse.json({ membership }, { status: 201 })
  } catch (error) {
    return respond(error, request, context, 'add')
  }
}

const removeMember: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ removed: await authorizationAdministrationService().removeGroupMember(
      authorizationActor(request, context),
      {
        groupId: context.parsedJson.groupId as string,
        userId: context.parsedJson.userId as string,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'remove')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listMembers)
}
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, addMember)
}
export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, removeMember)
}

async function respond(
  error: unknown,
  request: NextRequest,
  context: Parameters<BffDomainService>[1],
  operation: string,
) {
  return authorizationAdminErrorResponse(
    error,
    request,
    context,
    `authorization.group_member.${operation}`,
    'authorization_group',
  )
}
