export {
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_CAPABILITY_DEFINITIONS,
  getAuthorizationCapabilityDefinition,
  isAuthorizationCapability,
  type AuthorizationCapability,
  type AuthorizationCapabilityCategory,
  type AuthorizationCapabilityDefinition,
} from './capabilities'

export type {
  AuthorizationRepositories,
  CreateGroupInput,
  CreateRoleInput,
  GroupRepository,
  ResourceGrantRepository,
  ResourceOwnerRepository,
  RoleAssignmentRepository,
  RoleRepository,
  UpdateGroupInput,
  UpdateRoleInput,
  UpsertResourceGrantInput,
} from './repositories'

export {
  AUTHORIZATION_PRINCIPAL_TYPES,
  RESOURCE_ACCESS_ROLES,
  RESOURCE_ACTIONS,
  accessRoleAllows,
  isAuthorizationPrincipalType,
  isResourceAccessRole,
  strongestAccessRole,
  type AuthorizationDecision,
  type AuthorizationGroup,
  type AuthorizationPrincipalType,
  type AuthorizationRole,
  type AuthorizationSubject,
  type GroupMembership,
  type GroupRoleAssignment,
  type ResourceAccessRole,
  type ResourceAction,
  type ResourceGrant,
  type UserRoleAssignment,
} from './types'
