import 'server-only'

import { NextResponse } from 'next/server'
import type { AuthorizationCapability, AuthorizationSubject } from '@overlay/authz-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from './AuthorizationService'

export async function authorizeCatalogResource(args: {
  authorization: AuthorizationService
  capability: AuthorizationCapability
  context: AppApiRouteContext
  resourceId: string
  resourceType: string
}): Promise<NextResponse | null> {
  const subject = await resolveRouteSubject(args.authorization, args.context)
  const decision = await args.authorization.checkResolvedCatalogResourceAccess({
    capability: args.capability,
    resourceId: args.resourceId,
    resourceType: args.resourceType,
    subject,
  })
  if (decision.allowed || args.context.authorization?.evaluation.mode === 'observe') return null
  return NextResponse.json({
    error: 'authorization_denied',
    capability: args.capability,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
  }, { status: 403 })
}

export async function authorizeCapability(args: {
  authorization: AuthorizationService
  capability: AuthorizationCapability
  context: AppApiRouteContext
}): Promise<NextResponse | null> {
  const subject = await resolveRouteSubject(args.authorization, args.context)
  const decision = args.authorization.checkResolvedCapability(subject, args.capability)
  if (decision.allowed || args.context.authorization?.evaluation.mode === 'observe') return null
  return NextResponse.json({
    error: 'authorization_denied',
    capability: args.capability,
  }, { status: 403 })
}

export async function filterCatalogResources<T>(args: {
  authorization: AuthorizationService
  capability: AuthorizationCapability
  context: AppApiRouteContext
  getId: (value: T) => string
  resourceType: string
  values: readonly T[]
}): Promise<T[]> {
  if (args.context.authorization?.evaluation.mode === 'observe') return [...args.values]
  const subject = await resolveRouteSubject(args.authorization, args.context)
  const allowedIds = new Set(await args.authorization.filterCatalogResourceIds({
    capability: args.capability,
    resourceIds: args.values.map(args.getId),
    resourceType: args.resourceType,
    subject,
  }))
  return args.values.filter((value) => allowedIds.has(args.getId(value)))
}

async function resolveRouteSubject(
  authorization: AuthorizationService,
  context: AppApiRouteContext,
): Promise<AuthorizationSubject> {
  return context.authorization?.evaluation.subject
    ?? await authorization.resolveSubject(context.auth.userId)
}
