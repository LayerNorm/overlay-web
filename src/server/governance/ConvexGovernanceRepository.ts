import 'server-only'

import type {
  GovernanceAccessReview,
  GovernancePolicy,
  GovernanceRepository,
} from '@overlay/app-core'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

type ConvexPolicy = Omit<GovernancePolicy, 'id'> & {
  id?: string
  policyId: string
}
type ConvexReview = Omit<GovernanceAccessReview, 'id'> & {
  id?: string
  reviewId: string
}

export class ConvexGovernanceRepository implements GovernanceRepository {
  async createPolicyVersion(input: Parameters<GovernanceRepository['createPolicyVersion']>[0]) {
    return policy(await requiredMutation<ConvexPolicy>('createPolicyVersionByServer', {
      policyId: input.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      retentionUntil: input.retentionUntil,
      legalHold: input.legalHold,
      notes: input.notes,
      createdBy: input.createdBy,
    }))
  }

  async getPolicy(id: string) {
    const row = await query<ConvexPolicy | null>('getPolicyByServer', { policyId: id })
    return row ? policy(row) : null
  }

  async getActivePolicy(args: Parameters<GovernanceRepository['getActivePolicy']>[0]) {
    const row = await query<ConvexPolicy | null>('getActivePolicyByServer', args)
    return row ? policy(row) : null
  }

  async listPolicies(args: Parameters<GovernanceRepository['listPolicies']>[0] = {}) {
    const rows = await query<ConvexPolicy[]>('listPoliciesByServer', args ?? {}) ?? []
    return rows.map(policy)
  }

  async approvePolicy(args: Parameters<GovernanceRepository['approvePolicy']>[0]) {
    const row = await mutation<ConvexPolicy | null>('approvePolicyByServer', {
      policyId: args.id,
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
    })
    return row ? policy(row) : null
  }

  async rejectPolicy(args: Parameters<GovernanceRepository['rejectPolicy']>[0]) {
    const row = await mutation<ConvexPolicy | null>('rejectPolicyByServer', {
      policyId: args.id,
      rejectedBy: args.rejectedBy,
      rejectedAt: args.rejectedAt,
    })
    return row ? policy(row) : null
  }

  async createAccessReview(
    input: Parameters<GovernanceRepository['createAccessReview']>[0],
  ) {
    return review(await requiredMutation<ConvexReview>('createAccessReviewByServer', {
      reviewId: input.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerUserId: input.ownerUserId,
      grants: input.grants,
      createdBy: input.createdBy,
      notes: input.notes,
      dueAt: input.dueAt,
    }))
  }

  async getAccessReview(id: string) {
    const row = await query<ConvexReview | null>('getAccessReviewByServer', { reviewId: id })
    return row ? review(row) : null
  }

  async listAccessReviews(
    args: Parameters<GovernanceRepository['listAccessReviews']>[0] = {},
  ) {
    const rows = await query<ConvexReview[]>('listAccessReviewsByServer', args ?? {}) ?? []
    return rows.map(review)
  }

  async completeAccessReview(
    args: Parameters<GovernanceRepository['completeAccessReview']>[0],
  ) {
    const row = await mutation<ConvexReview | null>('completeAccessReviewByServer', {
      reviewId: args.id,
      reviewerUserId: args.reviewerUserId,
      notes: args.notes,
      completedAt: args.completedAt,
    })
    return row ? review(row) : null
  }

  async removeForResource(
    args: Parameters<GovernanceRepository['removeForResource']>[0],
  ): Promise<void> {
    await mutation('removeForResourceByServer', args)
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `admin/governance:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function mutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  return convex.mutation<T>(
    `admin/governance:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredMutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await mutation<T>(operation, args)
  if (!result) throw new Error(`Convex governance operation ${operation} returned no result`)
  return result
}

function policy(row: ConvexPolicy): GovernancePolicy {
  const { policyId, ...value } = clean(row)
  return { ...value, id: policyId }
}

function review(row: ConvexReview): GovernanceAccessReview {
  const { reviewId, ...value } = clean(row)
  return { ...value, id: reviewId }
}

function clean<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  delete copy.id
  return copy
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
