import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, optionalString, parseJson, queryParams } from '@/server/guard'

import { authorizationActor } from '../_utils'

const service = () => getAdminServerContext().authorizationAdministrationService
const AUDIT = (op: string) => ({
  auditAction: `authorization.role.${op}`,
  resourceType: 'authorization_role',
})

export const GET = adminRoute(async (request, context) => {
  const query = queryParams(request)
  const roleId = optionalString(query.roleId)
  if (roleId) {
    const assignments = await service().listRoleAssignments(
      authorizationActor(request, context),
      roleId,
    )
    return NextResponse.json({ assignments })
  }
  const assignments = await service().listAssignments(
    authorizationActor(request, context),
    {
      subjectId: query.subjectId as string,
      subjectType: query.subjectType as 'group' | 'user',
    },
  )
  return NextResponse.json({ assignments })
}, AUDIT('list'))

export const POST = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const assignment = await service().assignRole(
    authorizationActor(request, context),
    {
      roleId: body.roleId as string,
      subjectId: body.subjectId as string,
      subjectType: body.subjectType as 'group' | 'user',
    },
  )
  return NextResponse.json({ assignment }, { status: 201 })
}, { ...AUDIT('assign'), mutation: true })

export const DELETE = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const revoked = await service().revokeRole(
    authorizationActor(request, context),
    {
      roleId: body.roleId as string,
      subjectId: body.subjectId as string,
      subjectType: body.subjectType as 'group' | 'user',
    },
  )
  return NextResponse.json({ revoked })
}, { ...AUDIT('revoke'), mutation: true })
