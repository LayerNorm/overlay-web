import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { GovernedResourceType } from '@overlay/app-core'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  governanceActor,
  governanceErrorResponse,
  governanceService,
} from '../_utils'

const exportCompliance: BffDomainService = async (request, context) => {
  try {
    const evidence = await governanceService().exportCompliance(
      governanceActor(request, context),
      {
        resourceType: context.parsedQuery.resourceType as GovernedResourceType | undefined,
        resourceId: context.parsedQuery.resourceId as string | undefined,
      },
    )
    if (context.parsedQuery.format === 'csv') {
      return new NextResponse(toCsv(evidence), {
        headers: {
          'content-disposition': `attachment; filename="overlay-compliance-${evidence.exportedAt}.csv"`,
          'content-type': 'text/csv; charset=utf-8',
        },
      })
    }
    return NextResponse.json(evidence, {
      headers: {
        'content-disposition': `attachment; filename="overlay-compliance-${evidence.exportedAt}.json"`,
      },
    })
  } catch (error) {
    return governanceErrorResponse(error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, exportCompliance)
}

function toCsv(evidence: Awaited<ReturnType<ReturnType<typeof governanceService>['exportCompliance']>>): string {
  const rows: string[][] = [[
    'record_type',
    'id',
    'resource_type',
    'resource_id',
    'status_or_outcome',
    'actor',
    'created_at',
    'details_json',
  ]]
  for (const policy of evidence.policies) {
    rows.push([
      'policy',
      policy.id,
      policy.resourceType,
      policy.resourceId,
      policy.status,
      policy.approvedBy ?? policy.rejectedBy ?? policy.createdBy,
      new Date(policy.createdAt).toISOString(),
      JSON.stringify(policy),
    ])
  }
  for (const review of evidence.accessReviews) {
    rows.push([
      'access_review',
      review.id,
      review.resourceType,
      review.resourceId,
      review.status,
      review.reviewerUserId ?? review.createdBy,
      new Date(review.createdAt).toISOString(),
      JSON.stringify(review),
    ])
  }
  for (const event of evidence.auditEvents) {
    rows.push([
      'audit_event',
      event.id,
      event.resourceType,
      event.resourceId ?? '',
      event.outcome,
      event.actorUserId ?? event.actorApiKeyId ?? event.actorType,
      new Date(event.createdAt).toISOString(),
      JSON.stringify(event),
    ])
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
