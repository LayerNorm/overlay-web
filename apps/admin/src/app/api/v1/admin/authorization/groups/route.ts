import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, parseJson, queryParams } from '@/server/guard'

import { authorizationActor } from '../_utils'

const service = () => getAdminServerContext().authorizationAdministrationService
const AUDIT = (op: string) => ({
  auditAction: `authorization.group.${op}`,
  resourceType: 'authorization_group',
})

export const GET = adminRoute(async (request, context) => {
  const groups = await service().listGroups(
    authorizationActor(request, context),
    queryParams(request).includeArchived === true,
  )
  return NextResponse.json({ groups })
}, AUDIT('list'))

export const POST = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const group = await service().createGroup(
    authorizationActor(request, context),
    {
      description: body.description as string | undefined,
      name: body.name as string,
    },
  )
  return NextResponse.json({ group }, { status: 201 })
}, { ...AUDIT('create'), mutation: true })

export const PATCH = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const group = await service().updateGroup(
    authorizationActor(request, context),
    {
      description: body.description as string | undefined,
      groupId: body.groupId as string,
      name: body.name as string | undefined,
    },
  )
  return NextResponse.json({ group })
}, { ...AUDIT('update'), mutation: true })

export const DELETE = adminRoute(async (request, context) => {
  const body = await parseJson(request)
  const archived = await service().archiveGroup(
    authorizationActor(request, context),
    body.groupId as string,
  )
  return NextResponse.json({ archived })
}, { ...AUDIT('archive'), mutation: true })
