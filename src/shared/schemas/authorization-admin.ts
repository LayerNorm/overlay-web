import { z } from 'zod'
import {
  AUTHORIZATION_PRINCIPAL_TYPES,
  RESOURCE_ACCESS_ROLES,
  isAuthorizationCapability,
} from '@overlay/authz-contracts'

const Identifier = z.string().trim().min(1).max(256)
const Name = z.string().trim().min(1).max(120)
const Description = z.string().trim().max(1000).optional()
const Capability = z.string().refine(isAuthorizationCapability, 'Unknown authorization capability')
const IncludeArchived = z.enum(['true', 'false']).transform((value) => value === 'true').optional()

export const AdminAuthorizationEmptyQuery = z.object({})

export const AdminAuthorizationRoleListQuery = z.object({ includeArchived: IncludeArchived })
export const AdminAuthorizationRoleCreateRequest = z.object({
  name: Name,
  description: Description,
  capabilities: z.array(Capability).max(100).default([]),
})
export const AdminAuthorizationRoleUpdateRequest = z.object({
  roleId: Identifier,
  name: Name.optional(),
  description: Description,
  capabilities: z.array(Capability).max(100).optional(),
}).refine(({ name, description, capabilities }) => (
  name !== undefined || description !== undefined || capabilities !== undefined
), 'At least one role field is required')
export const AdminAuthorizationRoleDeleteRequest = z.object({ roleId: Identifier })

export const AdminAuthorizationGroupListQuery = z.object({ includeArchived: IncludeArchived })
export const AdminAuthorizationGroupCreateRequest = z.object({
  name: Name,
  description: Description,
})
export const AdminAuthorizationGroupUpdateRequest = z.object({
  groupId: Identifier,
  name: Name.optional(),
  description: Description,
}).refine(({ name, description }) => name !== undefined || description !== undefined, (
  { message: 'At least one group field is required' }
))
export const AdminAuthorizationGroupDeleteRequest = z.object({ groupId: Identifier })

export const AdminAuthorizationMembershipQuery = z.object({ groupId: Identifier })
export const AdminAuthorizationMembershipRequest = z.object({
  groupId: Identifier,
  userId: Identifier,
})

export const AdminAuthorizationAssignmentQuery = z.object({
  subjectType: z.enum(['user', 'group']),
  subjectId: Identifier,
})
export const AdminAuthorizationAssignmentRequest = AdminAuthorizationAssignmentQuery.extend({
  roleId: Identifier,
})

export const AdminAuthorizationGrantQuery = z.object({
  resourceType: Identifier,
  resourceId: Identifier,
})
export const AdminAuthorizationGrantCreateRequest = AdminAuthorizationGrantQuery.extend({
  principalType: z.enum(AUTHORIZATION_PRINCIPAL_TYPES),
  principalId: Identifier,
  accessRole: z.enum(RESOURCE_ACCESS_ROLES),
})
export const AdminAuthorizationGrantDeleteRequest = z.object({ grantId: Identifier })
