import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type {
  GovernanceAccessReviewStatus,
  GovernedResourceType,
} from '@overlay/app-core'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  governanceActor,
  governanceErrorResponse,
  governanceService,
} from '../_utils'

const listReviews: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({
      reviews: await governanceService().listAccessReviews(
        governanceActor(request, context),
        {
          resourceType: context.parsedQuery.resourceType as GovernedResourceType | undefined,
          resourceId: context.parsedQuery.resourceId as string | undefined,
          status: context.parsedQuery.status as GovernanceAccessReviewStatus | undefined,
        },
      ),
    })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

const createReview: BffDomainService = async (request, context) => {
  try {
    const input = context.parsedJson as {
      resourceType: GovernedResourceType
      resourceId: string
      notes?: string
      dueAt?: number
    }
    return NextResponse.json({
      review: await governanceService().createAccessReview(
        governanceActor(request, context),
        input,
      ),
    }, { status: 201 })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

const completeReview: BffDomainService = async (request, context) => {
  try {
    const input = context.parsedJson as { reviewId: string; notes?: string }
    return NextResponse.json({
      review: await governanceService().completeAccessReview(
        governanceActor(request, context),
        input,
      ),
    })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listReviews)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, createReview)
}

export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, completeReview)
}
