import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listRoles: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ roles: await authorizationAdministrationService().listRoles(
      authorizationActor(request, context),
      context.parsedQuery.includeArchived === true,
    ) })
  } catch (error) {
    return respond(error, request, context, 'list')
  }
}

const createRole: BffDomainService = async (request, context) => {
  try {
    const role = await authorizationAdministrationService().createRole(
      authorizationActor(request, context),
      {
        name: context.parsedJson.name as string,
        description: context.parsedJson.description as string | undefined,
        capabilities: context.parsedJson.capabilities as AuthorizationCapability[],
      },
    )
    return NextResponse.json({ role }, { status: 201 })
  } catch (error) {
    return respond(error, request, context, 'create')
  }
}

const updateRole: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ role: await authorizationAdministrationService().updateRole(
      authorizationActor(request, context),
      {
        roleId: context.parsedJson.roleId as string,
        name: context.parsedJson.name as string | undefined,
        description: context.parsedJson.description as string | undefined,
        capabilities: context.parsedJson.capabilities as AuthorizationCapability[] | undefined,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'update')
  }
}

const archiveRole: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ archived: await authorizationAdministrationService().archiveRole(
      authorizationActor(request, context),
      context.parsedJson.roleId as string,
    ) })
  } catch (error) {
    return respond(error, request, context, 'archive')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listRoles)
}
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, createRole)
}
export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, updateRole)
}
export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, archiveRole)
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
    `authorization.role.${operation}`,
    'authorization_role',
  )
}
