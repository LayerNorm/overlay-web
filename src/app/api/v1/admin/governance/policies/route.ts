import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type {
  GovernancePolicyStatus,
  GovernedResourceType,
} from '@overlay/app-core'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  governanceActor,
  governanceErrorResponse,
  governanceService,
} from '../_utils'

const listPolicies: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({
      policies: await governanceService().listPolicies(governanceActor(request, context), {
        resourceType: context.parsedQuery.resourceType as GovernedResourceType | undefined,
        resourceId: context.parsedQuery.resourceId as string | undefined,
        status: context.parsedQuery.status as GovernancePolicyStatus | undefined,
      }),
    })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

const createPolicy: BffDomainService = async (request, context) => {
  try {
    const input = context.parsedJson as {
      resourceType: GovernedResourceType
      resourceId: string
      retentionUntil?: number
      legalHold?: boolean
      notes?: string
    }
    return NextResponse.json({
      policy: await governanceService().createPolicyVersion(
        governanceActor(request, context),
        input,
      ),
    }, { status: 201 })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

const decidePolicy: BffDomainService = async (request, context) => {
  try {
    const input = context.parsedJson as {
      action: 'approve' | 'reject'
      policyId: string
    }
    const actor = governanceActor(request, context)
    const policy = input.action === 'approve'
      ? await governanceService().approvePolicy(actor, input.policyId)
      : await governanceService().rejectPolicy(actor, input.policyId)
    return NextResponse.json({ policy })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listPolicies)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, createPolicy)
}

export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, decidePolicy)
}
