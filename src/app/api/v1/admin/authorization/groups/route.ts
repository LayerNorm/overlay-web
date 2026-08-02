import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listGroups: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ groups: await authorizationAdministrationService().listGroups(
      authorizationActor(request, context),
      context.parsedQuery.includeArchived === true,
    ) })
  } catch (error) {
    return respond(error, request, context, 'list')
  }
}

const createGroup: BffDomainService = async (request, context) => {
  try {
    const group = await authorizationAdministrationService().createGroup(
      authorizationActor(request, context),
      {
        name: context.parsedJson.name as string,
        description: context.parsedJson.description as string | undefined,
      },
    )
    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    return respond(error, request, context, 'create')
  }
}

const updateGroup: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ group: await authorizationAdministrationService().updateGroup(
      authorizationActor(request, context),
      {
        groupId: context.parsedJson.groupId as string,
        name: context.parsedJson.name as string | undefined,
        description: context.parsedJson.description as string | undefined,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'update')
  }
}

const archiveGroup: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ archived: await authorizationAdministrationService().archiveGroup(
      authorizationActor(request, context),
      context.parsedJson.groupId as string,
    ) })
  } catch (error) {
    return respond(error, request, context, 'archive')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listGroups)
}
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, createGroup)
}
export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, updateGroup)
}
export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, archiveGroup)
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
    `authorization.group.${operation}`,
    'authorization_group',
  )
}
