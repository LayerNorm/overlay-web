/**
 * Whether a workspace has only one person in it. The interface follows this: a workspace that is just you has no
 * Personal/Workspace split, no person-to-person messages and no activity feed, and those appear when a second person
 * joins. It is derived, not a setting. See docs/plans/UNIFIED_SCOPES_PLAN.md (5b).
 */
import type { PanelScope } from './panel-scope'

export type WorkspaceHeadcount = {
  /** Active members who are people (not agents). */
  humanMemberCount?: number
  /** Active members, agents included: only a fallback for a backend that does not send the people count yet. */
  memberCount?: number
}

/** How many people are in the workspace; undefined when it is not known yet. */
export function peopleInWorkspace(workspace: WorkspaceHeadcount | null | undefined): number | undefined {
  return workspace?.humanMemberCount ?? workspace?.memberCount
}

/**
 * True only when it is known that the workspace has one person. An unknown count counts as "not solo", so the full
 * interface shows rather than a simplified one that hides things from people who share the workspace.
 */
export function isSoloWorkspace(workspace: WorkspaceHeadcount | null | undefined): boolean {
  const people = peopleInWorkspace(workspace)
  return people !== undefined && people <= 1
}

/** "1 member" / "3 members", counting people only. */
export function workspaceMemberLabel(workspace: WorkspaceHeadcount | null | undefined): string | null {
  const people = peopleInWorkspace(workspace)
  return people === undefined ? null : `${people} ${people === 1 ? 'member' : 'members'}`
}

/**
 * The scope to show. With nobody to share with there is no Workspace scope: a link or a remembered choice that says
 * `workspace` shows the person's one list (the Personal scope).
 */
export function soloPanelScope(scope: PanelScope, solo: boolean): PanelScope {
  return solo && scope === 'workspace' ? 'personal' : scope
}
