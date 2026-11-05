import type { QueryCtx } from '../_generated/server'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import { CAPABILITY_FEATURE } from '@/shared/authorization/capability-features'
import { requireNativeDeploymentFeature } from './nativeDeploymentPolicy'

const MAX_ASSIGNMENTS = 100

// No deployment-owner or operator bypass belongs in the customer browser path.
export async function requireNativeCapability(
  ctx: Pick<QueryCtx, 'db'>,
  userId: string,
  capability: AuthorizationCapability,
) {
  const feature = CAPABILITY_FEATURE[capability]
  if (feature) await requireNativeDeploymentFeature(ctx, feature)
  const [direct, memberships] = await Promise.all([
    ctx.db.query('authorizationUserRoles').withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_ASSIGNMENTS),
    ctx.db.query('authorizationGroupMemberships').withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_ASSIGNMENTS),
  ])
  if (direct.length === MAX_ASSIGNMENTS || memberships.length === MAX_ASSIGNMENTS) throw new Error('CAPABILITY_ACCESS_DENIED')
  const roleIds = new Set(direct.map(row => row.roleId))
  for (const membership of memberships) {
    const group = await ctx.db.query('authorizationGroups').withIndex('by_groupId', q => q.eq('groupId', membership.groupId)).unique()
    if (!group || group.archivedAt !== undefined) continue
    const roles = await ctx.db.query('authorizationGroupRoles').withIndex('by_groupId', q => q.eq('groupId', group.groupId)).take(MAX_ASSIGNMENTS)
    if (roles.length === MAX_ASSIGNMENTS) throw new Error('CAPABILITY_ACCESS_DENIED')
    for (const role of roles) roleIds.add(role.roleId)
    if (roleIds.size >= MAX_ASSIGNMENTS) throw new Error('CAPABILITY_ACCESS_DENIED')
  }
  for (const roleId of roleIds) {
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', roleId)).unique()
    if (role && role.archivedAt === undefined && role.capabilities.includes(capability)) return
  }
  throw new Error('CAPABILITY_ACCESS_DENIED')
}
