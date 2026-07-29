import type {
  GovernanceAccessReview,
  GovernanceAccessReviewStatus,
  GovernancePolicy,
  GovernancePolicyStatus,
  GovernedResourceType,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export type GovernanceFilters = {
  resourceType?: GovernedResourceType
  resourceId?: string
}

export type GovernanceComplianceEvidence = {
  exportedAt: number
  policies: GovernancePolicy[]
  accessReviews: GovernanceAccessReview[]
  auditEvents: Array<{
    id: string
    action: string
    actorApiKeyId?: string
    actorType: string
    actorUserId?: string
    createdAt: number
    metadata?: Record<string, unknown>
    outcome: string
    resourceId?: string
    resourceType: string
  }>
}

export class AdminGovernanceClient {
  constructor(private readonly http: HttpContext) {}

  async listPolicies(
    query: GovernanceFilters & { status?: GovernancePolicyStatus } = {},
    init?: RequestInit,
  ): Promise<GovernancePolicy[]> {
    const payload = await this.http.json<{ policies: GovernancePolicy[] }>(
      this.http.appendQuery('/api/v1/admin/governance/policies', query),
      init,
    )
    return payload.policies
  }

  async createPolicy(body: {
    resourceType: GovernedResourceType
    resourceId: string
    retentionUntil?: number
    legalHold?: boolean
    notes?: string
  }, init?: RequestInit): Promise<GovernancePolicy> {
    const payload = await this.http.json<{ policy: GovernancePolicy }>(
      '/api/v1/admin/governance/policies',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
    return payload.policy
  }

  async decidePolicy(
    body: { policyId: string; action: 'approve' | 'reject' },
    init?: RequestInit,
  ): Promise<GovernancePolicy> {
    const payload = await this.http.json<{ policy: GovernancePolicy }>(
      '/api/v1/admin/governance/policies',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
    return payload.policy
  }

  async listAccessReviews(
    query: GovernanceFilters & { status?: GovernanceAccessReviewStatus } = {},
    init?: RequestInit,
  ): Promise<GovernanceAccessReview[]> {
    const payload = await this.http.json<{ reviews: GovernanceAccessReview[] }>(
      this.http.appendQuery('/api/v1/admin/governance/reviews', query),
      init,
    )
    return payload.reviews
  }

  async createAccessReview(body: {
    resourceType: GovernedResourceType
    resourceId: string
    dueAt?: number
    notes?: string
  }, init?: RequestInit): Promise<GovernanceAccessReview> {
    const payload = await this.http.json<{ review: GovernanceAccessReview }>(
      '/api/v1/admin/governance/reviews',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
    return payload.review
  }

  async completeAccessReview(
    body: { reviewId: string; notes?: string },
    init?: RequestInit,
  ): Promise<GovernanceAccessReview> {
    const payload = await this.http.json<{ review: GovernanceAccessReview }>(
      '/api/v1/admin/governance/reviews',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
    return payload.review
  }

  exportUrl(
    query: GovernanceFilters & { format?: 'csv' | 'json' } = {},
  ): string {
    return this.http.appendQuery('/api/v1/admin/governance/export', query)
  }

  exportCompliance(
    query: GovernanceFilters = {},
    init?: RequestInit,
  ): Promise<GovernanceComplianceEvidence> {
    return this.http.json<GovernanceComplianceEvidence>(
      this.exportUrl({ ...query, format: 'json' }),
      init,
    )
  }
}
