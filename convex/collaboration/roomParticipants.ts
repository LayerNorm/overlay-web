import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { resolveIdentityDisplayName, versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'
type CollaborationCtx = Pick<QueryCtx, 'db'>

function participantView(
  participant: Doc<'conversationParticipants'>,
  principal: Doc<'workspacePrincipals'>,
  account?: Doc<'subscriptions'> | null,
) {
  const providerName = [account?.firstName, account?.lastName].filter(Boolean).join(' ').trim()
    || account?.name
  const photoUrl = principal.type === 'human'
    ? principal.photoObjectKey
      ? versionedIdentityUrl(
          `/api/v1/workspaces/${encodeURIComponent(participant.workspaceId)}/profile/photo?principalId=${encodeURIComponent(principal.principalId)}`,
          principal.photoObjectKey,
        )
      : account?.photoObjectKey
        ? versionedIdentityUrl(
            `/api/v1/account/profile/photo?userId=${encodeURIComponent(principal.userId ?? '')}`,
            account.photoObjectKey,
          )
        : account?.profilePictureUrl
    : undefined
  return {
    conversationId: participant.conversationId,
    workspaceId: participant.workspaceId,
    principalId: participant.principalId,
    principalType: participant.principalType,
    displayName: principal.type === 'human'
      ? resolveIdentityDisplayName({
          workspaceOverride: principal.displayNameOverride,
          accountOverride: account?.displayNameOverride,
          providerName,
          legacyDisplayName: principal.displayName,
          email: account?.email ?? principal.email,
        })
      : principal.displayName,
    ...(photoUrl ? { photoUrl } : {}),
    email: principal.email,
    role: participant.role,
    status: participant.status,
    notificationLevel: participant.notificationLevel,
    joinedAt: participant.joinedAt,
    updatedAt: participant.updatedAt,
    removedAt: participant.removedAt,
    lastReadAt: participant.lastReadAt,
    lastReadSequence: participant.lastReadSequence,
    markedUnreadAt: participant.markedUnreadAt,
    archivedAt: participant.archivedAt,
  }
}

export async function participantViewById(
  ctx: CollaborationCtx,
  participant: Doc<'conversationParticipants'>,
) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', participant.principalId))
    .unique()
  if (!principal) throw new Error('Participant principal is missing')
  const account = principal.type === 'human' && principal.userId
    ? await ctx.db.query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', principal.userId!))
      .first()
    : null
  return participantView(participant, principal, account)
}

export async function resolvedPrincipalName(
  ctx: CollaborationCtx,
  principal: Doc<'workspacePrincipals'>,
): Promise<string> {
  if (principal.type !== 'human' || !principal.userId) return principal.displayName
  const account = await ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', principal.userId!))
    .first()
  const providerName = [account?.firstName, account?.lastName].filter(Boolean).join(' ').trim()
    || account?.name
  return resolveIdentityDisplayName({
    workspaceOverride: principal.displayNameOverride,
    accountOverride: account?.displayNameOverride,
    providerName,
    legacyDisplayName: principal.displayName,
    email: account?.email ?? principal.email,
  })
}

export async function participantViews(
  ctx: CollaborationCtx,
  conversationId: Id<'conversations'>,
  limit?: number,
) {
  const query = ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', (q) => (
      q.eq('conversationId', conversationId).eq('status', 'active')
    ))
  const rows = limit === undefined ? await query.collect() : await query.take(limit + 1)
  if (limit !== undefined && rows.length > limit) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  const sorted = rows.sort((a, b) => a.joinedAt - b.joinedAt)
  const principals = await Promise.all(sorted.map((row) => ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId))
    .unique()))
  if (principals.some((principal) => !principal)) throw new Error('Participant principal is missing')
  const userIds = Array.from(new Set(principals.flatMap((principal) =>
    principal?.type === 'human' && principal.userId ? [principal.userId] : [])))
  const accounts = await Promise.all(userIds.map((userId) => ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()))
  const accountByUserId = new Map(accounts.filter(Boolean).map((account) => [account!.userId, account!]))
  return sorted.map((row, index) => {
    const principal = principals[index]!
    return participantView(
      row,
      principal,
      principal.type === 'human' && principal.userId
        ? accountByUserId.get(principal.userId)
        : undefined,
    )
  })
}
