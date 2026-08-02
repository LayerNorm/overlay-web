import type {
  AuthorizationPrincipalType,
  ResourceAccessRole,
} from '@overlay/authz-contracts'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listGrants: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ grants: await authorizationAdministrationService().listResourceGrants(
      authorizationActor(request, context),
      {
        resourceType: context.parsedQuery.resourceType as string,
        resourceId: context.parsedQuery.resourceId as string,
      },
    ) })
  } catch (error) {
    return respond(error, request, context, 'list')
  }
}

const upsertGrant: BffDomainService = async (request, context) => {
  try {
    const grant = await authorizationAdministrationService().upsertResourceGrant(
      authorizationActor(request, context),
      {
        resourceType: context.parsedJson.resourceType as string,
        resourceId: context.parsedJson.resourceId as string,
        principalType: context.parsedJson.principalType as AuthorizationPrincipalType,
        principalId: context.parsedJson.principalId as string,
        accessRole: context.parsedJson.accessRole as ResourceAccessRole,
      },
    )
    return NextResponse.json({ grant }, { status: 201 })
  } catch (error) {
    return respond(error, request, context, 'upsert')
  }
}

const removeGrant: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({ removed: await authorizationAdministrationService().removeResourceGrant(
      authorizationActor(request, context),
      context.parsedJson.grantId as string,
    ) })
  } catch (error) {
    return respond(error, request, context, 'remove')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listGrants)
}
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, upsertGrant)
}
export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, removeGrant)
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
    `authorization.resource_grant.${operation}`,
    'authorization_resource_grant',
  )
}
