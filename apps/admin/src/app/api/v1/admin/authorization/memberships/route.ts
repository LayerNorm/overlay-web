import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, parseJson, queryParams, requiredString } from '@/server/guard'

import { authorizationActor } from '../_utils'

const service = () => getAdminServerContext().authorizationAdministrationService
const AUDIT = (op: string) => ({
  auditAction: `authorization.group_member.${op}`,
  resourceType: 'authorization_group',
})

export const GET = adminRoute(async (request, context) => {
  const memberships = await service().listGroupMembers(
    authorizationActor(request, context),
    requiredString(queryParams(request).groupId),
  )
  return NextResponse.json({ memberships })
}, AUDIT('list'))

export const POST = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const membership = await service().addGroupMember(
    authorizationActor(request, context),
    {
      groupId: requiredString(body.groupId),
      userId: requiredString(body.userId),
    },
  )
  return NextResponse.json({ membership }, { status: 201 })
}, { ...AUDIT('add'), mutation: true })

export const DELETE = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const removed = await service().removeGroupMember(
    authorizationActor(request, context),
    {
      groupId: requiredString(body.groupId),
      userId: requiredString(body.userId),
    },
  )
  return NextResponse.json({ removed })
}, { ...AUDIT('remove'), mutation: true })
