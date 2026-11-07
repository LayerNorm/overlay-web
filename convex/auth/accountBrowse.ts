import { query } from '../_generated/server'
import { resolveIdentityDisplayName, versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'

/**
 * The signed-in person's account name and photo, live, resolved exactly as the account profile route does (their
 * override, else the sign-in provider's name, else their email). A rename or new photo saved in another tab or device
 * shows everywhere at once. Null when signed out or before the account record exists.
 */
export const identity = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await ctx.auth.getUserIdentity()
    if (!viewer?.subject) return null
    const account = await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', viewer.subject)).first()
    if (!account) return null
    const providerName = [account.firstName, account.lastName].filter(Boolean).join(' ').trim() || account.name?.trim()
    return {
      displayName: resolveIdentityDisplayName({ accountOverride: account.displayNameOverride, providerName, email: account.email }),
      photoUrl: account.photoObjectKey
        ? versionedIdentityUrl(`/api/v1/account/profile/photo?userId=${encodeURIComponent(account.userId)}`, account.photoObjectKey)
        : account.profilePictureUrl ?? null,
      displayNameOverride: account.displayNameOverride ?? null,
      hasCustomPhoto: Boolean(account.photoObjectKey),
      email: account.email ?? '',
    }
  },
})
