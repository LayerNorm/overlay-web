import type { AuthorizationPrincipalType, ResourceAccessRole } from '@overlay/authz-contracts'
import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, parseJson, queryParams, requiredString } from '@/server/guard'

import { authorizationActor } from '../_utils'

const service = () => getAdminServerContext().authorizationAdministrationService
const AUDIT = (op: string) => ({
  auditAction: `authorization.resource_grant.${op}`,
  resourceType: 'authorization_resource_grant',
})

export const GET = adminRoute(async (request, context) => {
  const query = queryParams(request)
  const grants = await service().listResourceGrants(
    authorizationActor(request, context),
    {
      resourceId: requiredString(query.resourceId),
      resourceType: requiredString(query.resourceType),
    },
  )
  return NextResponse.json({ grants })
}, AUDIT('list'))

export const POST = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const grant = await service().upsertResourceGrant(
    authorizationActor(request, context),
    {
      accessRole: body.accessRole as ResourceAccessRole,
      principalId: body.principalId as string,
      principalType: body.principalType as AuthorizationPrincipalType,
      resourceId: body.resourceId as string,
      resourceType: body.resourceType as string,
    },
  )
  return NextResponse.json({ grant }, { status: 201 })
}, { ...AUDIT('upsert'), mutation: true })

export const DELETE = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const removed = await service().removeResourceGrant(
    authorizationActor(request, context),
    body.grantId as string,
  )
  return NextResponse.json({ removed })
}, { ...AUDIT('remove'), mutation: true })
