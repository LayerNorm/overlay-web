import type { AuthorizationCapability } from '@overlay/authz-contracts'
import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, parseJson, queryParams } from '@/server/guard'

import { authorizationActor } from '../_utils'

const service = () => getAdminServerContext().authorizationAdministrationService
const AUDIT = (op: string) => ({
  auditAction: `authorization.role.${op}`,
  resourceType: 'authorization_role',
})

export const GET = adminRoute(async (request, context) => {
  const roles = await service().listRoles(
    authorizationActor(request, context),
    queryParams(request).includeArchived === true,
  )
  return NextResponse.json({ roles })
}, AUDIT('list'))

export const POST = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const role = await service().createRole(
    authorizationActor(request, context),
    {
      capabilities: body.capabilities as AuthorizationCapability[],
      description: body.description as string | undefined,
      name: body.name as string,
    },
  )
  return NextResponse.json({ role }, { status: 201 })
}, { ...AUDIT('create'), mutation: true })

export const PATCH = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const role = await service().updateRole(
    authorizationActor(request, context),
    {
      capabilities: body.capabilities as AuthorizationCapability[] | undefined,
      description: body.description as string | undefined,
      name: body.name as string | undefined,
      roleId: body.roleId as string,
    },
  )
  return NextResponse.json({ role })
}, { ...AUDIT('update'), mutation: true })

export const DELETE = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const archived = await service().archiveRole(
    authorizationActor(request, context),
    body.roleId as string,
  )
  return NextResponse.json({ archived })
}, { ...AUDIT('archive'), mutation: true })
