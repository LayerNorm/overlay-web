import type { ResourceGrant } from '@overlay/authz-contracts'

export const GOVERNED_RESOURCE_TYPES = ['project', 'knowledge_base'] as const
export type GovernedResourceType = (typeof GOVERNED_RESOURCE_TYPES)[number]

export const GOVERNANCE_POLICY_STATUSES = [
  'draft',
  'active',
  'superseded',
  'rejected',
] as const
export type GovernancePolicyStatus = (typeof GOVERNANCE_POLICY_STATUSES)[number]

export const GOVERNANCE_ACCESS_REVIEW_STATUSES = ['open', 'completed'] as const
export type GovernanceAccessReviewStatus =
  (typeof GOVERNANCE_ACCESS_REVIEW_STATUSES)[number]

export type GovernancePolicy = {
  id: string
  resourceType: GovernedResourceType
  resourceId: string
  version: number
  status: GovernancePolicyStatus
  retentionUntil?: number
  legalHold: boolean
  notes?: string
  createdBy: string
  approvedBy?: string
  approvedAt?: number
  rejectedBy?: string
  rejectedAt?: number
  createdAt: number
  updatedAt: number
}

export type GovernanceAccessReview = {
  id: string
  resourceType: GovernedResourceType
  resourceId: string
  status: GovernanceAccessReviewStatus
  ownerUserId?: string
  grants: ResourceGrant[]
  createdBy: string
  reviewerUserId?: string
  notes?: string
  dueAt?: number
  createdAt: number
  completedAt?: number
}

export type CreateGovernancePolicyVersionInput = Pick<
  GovernancePolicy,
  'id' | 'resourceType' | 'resourceId' | 'legalHold' | 'createdBy'
> & Partial<Pick<GovernancePolicy, 'retentionUntil' | 'notes'>>

export type CreateGovernanceAccessReviewInput = Pick<
  GovernanceAccessReview,
  'id' | 'resourceType' | 'resourceId' | 'grants' | 'createdBy'
> & Partial<Pick<
  GovernanceAccessReview,
  'ownerUserId' | 'notes' | 'dueAt'
>>

export interface GovernanceRepository {
  createPolicyVersion(input: CreateGovernancePolicyVersionInput): Promise<GovernancePolicy>
  getPolicy(id: string): Promise<GovernancePolicy | null>
  getActivePolicy(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<GovernancePolicy | null>
  listPolicies(args?: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernancePolicyStatus
  }): Promise<GovernancePolicy[]>
  approvePolicy(args: {
    id: string
    approvedBy: string
    approvedAt: number
  }): Promise<GovernancePolicy | null>
  rejectPolicy(args: {
    id: string
    rejectedBy: string
    rejectedAt: number
  }): Promise<GovernancePolicy | null>
  createAccessReview(input: CreateGovernanceAccessReviewInput): Promise<GovernanceAccessReview>
  getAccessReview(id: string): Promise<GovernanceAccessReview | null>
  listAccessReviews(args?: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernanceAccessReviewStatus
  }): Promise<GovernanceAccessReview[]>
  completeAccessReview(args: {
    id: string
    reviewerUserId: string
    notes?: string
    completedAt: number
  }): Promise<GovernanceAccessReview | null>
  removeForResource(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<void>
}
