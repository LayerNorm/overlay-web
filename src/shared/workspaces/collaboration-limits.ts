/**
 * Abuse limits for collaboration. Every limit is keyed by the workspace first so
 * one tenant can never consume another's budget, then narrowed to the principal,
 * room, agent, or guest that actually performed the action.
 */
export type CollaborationLimitSpec = {
  bucket: string
  limit: number
  windowMs: number
}

export type CollaborationLimitScope = {
  workspaceId: string
  principalId?: string
  conversationId?: string
  agentId?: string
  /** Guests are limited harder than members because they are external. */
  guest?: boolean
}

export type CollaborationAction =
  | 'message.send'
  | 'agent.invoke'
  | 'invitation.create'
  | 'share.grant'
  | 'search.query'
  | 'audit.export'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Per-action ceilings: workspace-wide, per principal, and per narrow target. */
const ACTION_LIMITS: Record<CollaborationAction, {
  workspace: CollaborationLimitSpec
  principal: CollaborationLimitSpec
  guestPrincipal?: CollaborationLimitSpec
  narrow?: CollaborationLimitSpec
}> = {
  'message.send': {
    workspace: { bucket: 'workspace', limit: 3_000, windowMs: MINUTE },
    principal: { bucket: 'principal', limit: 120, windowMs: MINUTE },
    guestPrincipal: { bucket: 'guest', limit: 30, windowMs: MINUTE },
    narrow: { bucket: 'room', limit: 600, windowMs: MINUTE },
  },
  'agent.invoke': {
    workspace: { bucket: 'workspace', limit: 600, windowMs: MINUTE },
    principal: { bucket: 'principal', limit: 60, windowMs: MINUTE },
    guestPrincipal: { bucket: 'guest', limit: 10, windowMs: MINUTE },
    narrow: { bucket: 'agent', limit: 120, windowMs: MINUTE },
  },
  'invitation.create': {
    workspace: { bucket: 'workspace', limit: 200, windowMs: HOUR },
    principal: { bucket: 'principal', limit: 50, windowMs: HOUR },
    guestPrincipal: { bucket: 'guest', limit: 0, windowMs: HOUR },
  },
  'share.grant': {
    workspace: { bucket: 'workspace', limit: 1_000, windowMs: HOUR },
    principal: { bucket: 'principal', limit: 200, windowMs: HOUR },
    guestPrincipal: { bucket: 'guest', limit: 0, windowMs: HOUR },
  },
  'search.query': {
    workspace: { bucket: 'workspace', limit: 6_000, windowMs: MINUTE },
    principal: { bucket: 'principal', limit: 120, windowMs: MINUTE },
    guestPrincipal: { bucket: 'guest', limit: 60, windowMs: MINUTE },
  },
  'audit.export': {
    workspace: { bucket: 'workspace', limit: 12, windowMs: HOUR },
    principal: { bucket: 'principal', limit: 6, windowMs: HOUR },
    guestPrincipal: { bucket: 'guest', limit: 0, windowMs: HOUR },
  },
}

export type ResolvedCollaborationLimit = {
  key: string
  limits: CollaborationLimitSpec[]
}

/**
 * Builds the rate-limit keys for an action. Guests get their own bucket rather
 * than sharing the member bucket, so a guest burst cannot exhaust a member's
 * allowance or hide inside it.
 */
export function resolveCollaborationLimits(
  action: CollaborationAction,
  scope: CollaborationLimitScope,
): ResolvedCollaborationLimit[] {
  const config = ACTION_LIMITS[action]
  const resolved: ResolvedCollaborationLimit[] = [{
    key: `collab:${action}:workspace:${scope.workspaceId}`,
    limits: [config.workspace],
  }]
  if (scope.principalId) {
    const principalSpec = scope.guest && config.guestPrincipal
      ? config.guestPrincipal
      : config.principal
    resolved.push({
      key: `collab:${action}:${scope.guest ? 'guest' : 'principal'}:${scope.workspaceId}:${scope.principalId}`,
      limits: [principalSpec],
    })
  }
  const narrowTarget = scope.agentId ?? scope.conversationId
  if (config.narrow && narrowTarget) {
    resolved.push({
      key: `collab:${action}:narrow:${scope.workspaceId}:${narrowTarget}`,
      limits: [config.narrow],
    })
  }
  return resolved
}

/** A zero limit means the action is forbidden for that scope, not unlimited. */
export function isForbiddenByLimit(limits: readonly CollaborationLimitSpec[]): boolean {
  return limits.some((limit) => limit.limit <= 0)
}
