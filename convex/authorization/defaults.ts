import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { MEMBER_AUTHORIZATION_CAPABILITIES, MEMBER_AUTHORIZATION_ROLE_ID } from '../../src/shared/authorization/default-member-role'

/** Customer web can initialize only the fixed ordinary member role, never operator roles. */
export const ensureDefaultUserRoleByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!args.userId.trim()) throw new Error('User id required')
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', MEMBER_AUTHORIZATION_ROLE_ID)).unique()
    if (role && !role.isSystem) throw new Error('Reserved member role is not a system role')
    if (!role) {
      await ctx.db.insert('authorizationRoles', {
        roleId: MEMBER_AUTHORIZATION_ROLE_ID, name: '[System] Default member',
        description: 'Built-in baseline role for authenticated Overlay product access.',
        capabilities: MEMBER_AUTHORIZATION_CAPABILITIES, isSystem: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }
    const assignments = await ctx.db.query('authorizationUserRoles').withIndex('by_userId', q => q.eq('userId', args.userId)).collect()
    // Preserve explicit custom assignments, matching the existing shell contract.
    const compatibility = new Set(['system:administrator', 'system:auditor', 'system:billing-administrator', 'system:support'])
    if (assignments.some(a => !compatibility.has(a.roleId))) return null
    await ctx.db.insert('authorizationUserRoles', {
      userId: args.userId, roleId: MEMBER_AUTHORIZATION_ROLE_ID,
      createdAt: Date.now(),
    })
    return null
  },
})
