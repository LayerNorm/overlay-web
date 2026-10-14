import 'server-only'

import type { WorkspaceMembershipRole } from '@overlay/workspace-contracts'
import { canManageWorkspace } from '@overlay/workspace-contracts'

/**
 * Who may open the live desktop of an Overlay Cloud machine: whoever may use the agent it belongs to. A personal agent
 * ("Only me") is its creator's alone; a workspace agent's machine is open to the workspace's members. Guests are left
 * out (controlling a machine is more than chatting with its agent), and being an owner or admin adds nothing for a
 * personal agent: managing a workspace is not access to a person's private things.
 *
 * `boundAgents` is how many agents the machine belongs to; `visibleBoundAgents` is how many of those the caller may see
 * (the agent directory already hides personal agents from everyone but their creator). A machine that belongs to no
 * agent falls back to workspace managers.
 */
export function canUseEnvironmentDesktop(args: {
  role: WorkspaceMembershipRole
  boundAgents: number
  visibleBoundAgents: number
}): boolean {
  if (args.boundAgents === 0) return canManageWorkspace(args.role)
  if (args.role === 'guest') return false
  return args.visibleBoundAgents > 0
}
