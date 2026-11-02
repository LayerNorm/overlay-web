export type AdminCatalogResourceType = 'connector' | 'model' | 'tool'

export type AdminCatalogResource = {
  category?: string
  description?: string
  id: string
  label: string
  resourceType: AdminCatalogResourceType
}

/** One person in the People directory. */
export type AdminUsageRow = {
  userId: string
  email?: string
  name?: string
  /** Account creation time, ms. */
  createdAt?: number
  /** Latest UTC day counted as active by the nightly growth job. */
  lastActiveDay?: string
  plan?: 'paid' | 'free'
}

export type AdminAuditRow = {
  action: string
  actorUserId?: string
  createdAt: number
  id: string
  outcome: string
  resourceId?: string
  resourceType: string
}

export const ADMINISTRATIVE_ROLES = ['admin', 'auditor', 'billing_admin', 'support'] as const
export type AdministrativeRole = (typeof ADMINISTRATIVE_ROLES)[number]

export type AdminPrincipal = {
  createdAt: number
  grantedBy?: string
  reason?: string
  revokedAt?: number
  revokedBy?: string
  role: AdministrativeRole
  updatedAt: number
  userId: string
}

/** One UTC day of growth rollups, as `admin/console:getGrowthSummary` returns it. */
export type AdminGrowthDay = {
  day: string
  usersCreated: number
  tasksCreated: number
  agentsCreated: number
  automationsCreated: number
  filesCreated: number
  filesEdited: number
  threadsCreated: number
  messagesSent: number
  automationRuns: number
  automationRunsSucceeded: number
  automationRunsFailed: number
  topUps: number
  topUpCents: number
  usageCents: number
  sandboxSeconds: number
  activeUsers: number
  weeklyActiveUsers: number
  monthlyActiveUsers: number
  paidSubscriptions?: number
  newPaidSubscriptions: number
  newPaidApproximate: number
  computedAt: number
}

export type AdminGrowthCohort = {
  weekStart: string
  users: number
  w1Active: number
  w4Active: number
  w1Final: boolean
  w4Final: boolean
}

export type AdminGrowthWorkspace = {
  workspaceId: string
  name: string | null
  kind: 'personal' | 'organization' | null
  cents: number
  sandboxSeconds: number
}

export type AdminGrowthSummary = {
  lastCompletedDay: string | null
  computedAt: number | null
  days: AdminGrowthDay[]
  cohorts: AdminGrowthCohort[]
  topWorkspaces: AdminGrowthWorkspace[]
}
