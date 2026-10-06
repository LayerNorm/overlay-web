/**
 * The free allowance belongs to a workspace, not to a person (docs/plans/UNIFIED_SCOPES_PLAN.md, 5b): everyone working
 * in a free workspace draws from the same weekly count (ask / write / agent turns, transcription seconds), so a free
 * workspace and a paid pool read the same way. A person on a paid plan keeps counting under their own id.
 *
 * The counts live in `dailyUsage`, whose `userId` column holds the counting subject: a person's id, or this key for a
 * workspace. A workspace key can never collide with a user id.
 */
const WORKSPACE_ALLOWANCE_PREFIX = 'workspace:'

/** How many free workspaces one person may own. A further workspace needs a plan, so creating workspaces cannot multiply the allowance. */
export const MAX_FREE_WORKSPACES_PER_OWNER = 3

export function workspaceAllowanceSubject(workspaceId: string): string {
  return `${WORKSPACE_ALLOWANCE_PREFIX}${workspaceId}`
}

export function isWorkspaceAllowanceSubject(subject: string): boolean {
  return subject.startsWith(WORKSPACE_ALLOWANCE_PREFIX)
}

/**
 * Who a usage count belongs to: the workspace the person is working in when they are on the free plan (and are in one),
 * otherwise the person. Paid plans are unchanged until a plan can be attached to a workspace.
 */
export function usageCountSubject(args: { userId: string; free: boolean; activeWorkspaceId?: string | null }): string {
  const workspaceId = args.activeWorkspaceId?.trim()
  return args.free && workspaceId ? workspaceAllowanceSubject(workspaceId) : args.userId
}
