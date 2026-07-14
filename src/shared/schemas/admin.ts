import { z } from 'zod'

export const AdminAuditListQuery = z.object({
  action: z.string().optional(),
  actorUserId: z.string().optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  resourceType: z.string().optional(),
})

export const AdminPrincipalListQuery = z.object({})

export const AdminPrincipalRequest = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'auditor', 'billing_admin', 'support']),
  reason: z.string().optional(),
})

export const AdminPrincipalDeleteRequest = z.object({
  userId: z.string().min(1),
})

export const AdminUsageListQuery = z.object({
  userId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const AdminUsageAdjustRequest = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().finite(),
})
