import { z } from 'zod'
import {
  GOVERNANCE_ACCESS_REVIEW_STATUSES,
  GOVERNANCE_POLICY_STATUSES,
  GOVERNED_RESOURCE_TYPES,
} from '@overlay/app-core'

const Identifier = z.string().trim().min(1).max(200)
const ResourceType = z.enum(GOVERNED_RESOURCE_TYPES)
const Notes = z.string().trim().max(2_000).optional()
const Timestamp = z.number().int().positive()

export const GovernancePolicyListQuery = z.object({
  resourceType: ResourceType.optional(),
  resourceId: Identifier.optional(),
  status: z.enum(GOVERNANCE_POLICY_STATUSES).optional(),
})

export const CreateGovernancePolicyRequest = z.object({
  resourceType: ResourceType,
  resourceId: Identifier,
  retentionUntil: Timestamp.optional(),
  legalHold: z.boolean().optional(),
  notes: Notes,
})

export const DecideGovernancePolicyRequest = z.object({
  policyId: Identifier,
  action: z.enum(['approve', 'reject']),
})

export const GovernanceAccessReviewListQuery = z.object({
  resourceType: ResourceType.optional(),
  resourceId: Identifier.optional(),
  status: z.enum(GOVERNANCE_ACCESS_REVIEW_STATUSES).optional(),
})

export const CreateGovernanceAccessReviewRequest = z.object({
  resourceType: ResourceType,
  resourceId: Identifier,
  dueAt: Timestamp.optional(),
  notes: Notes,
})

export const CompleteGovernanceAccessReviewRequest = z.object({
  reviewId: Identifier,
  notes: Notes,
})

export const GovernanceComplianceExportQuery = z.object({
  resourceType: ResourceType.optional(),
  resourceId: Identifier.optional(),
  format: z.enum(['json', 'csv']).default('json'),
})
