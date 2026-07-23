import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listAssignments: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ assignments: await authorizationAdministrationService().listAssignments(
      authorizationActor(request, context),
      {
        subjectType: context.parsedQuery.subjectType as 'user' | 'group',
        subjectId: context.parsedQuery.subjectId as string,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'list')
  }
}

const assignRole: BffDomainService = async (request, context) => {
  try {
    const assignment = await authorizationAdministrationService().assignRole(
      authorizationActor(request, context),
      {
        subjectType: context.parsedJson.subjectType as 'user' | 'group',
        subjectId: context.parsedJson.subjectId as string,
        roleId: context.parsedJson.roleId as string,
      },
    )
    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    return respond(error, request, context, 'assign')
  }
}

const revokeRole: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ revoked: await authorizationAdministrationService().revokeRole(
      authorizationActor(request, context),
      {
        subjectType: context.parsedJson.subjectType as 'user' | 'group',
        subjectId: context.parsedJson.subjectId as string,
        roleId: context.parsedJson.roleId as string,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'revoke')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listAssignments)
}
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, assignRole)
}
export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, revokeRole)
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
